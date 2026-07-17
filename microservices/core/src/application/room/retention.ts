// Application-layer retention sweep — room-and-folders (slice 2) / T-010
// (folds in the T-012 draft janitor).
//
// A system job (no authenticated actor) that, per org, reclaims data whose
// retention window has elapsed:
//   1. Documents soft-deleted > 30 days ago (FR17) — hard-deleted.
//   2. Opportunity subrooms archived > 90 days ago (FR6) — every document
//      in the subroom is hard-deleted, THEN the opportunity row (the
//      `documents.opportunity_id` FK is ON DELETE NO ACTION, so docs must
//      go first).
//   3. Draft documents (abandoned uploads) > 24 hours old — purged (T-012).
//
// ── Tenant isolation (ADR-011 / tenant-isolation slice 10) ────────────
// There is deliberately no "all-orgs handle" over tenant data. The sweep
// enumerates org IDs via `OrgRepo.listAllIds()` — the `organizations`
// table is TENANT_AGNOSTIC (the org IS the tenant), so listing its
// partition keys is not a cross-tenant read — then processes ONE
// `systemScope(orgId, db, { reason })` per org. Every document/opportunity
// read + write below goes through that per-org scope. `reason` is
// mandatory and rides into the audit trail via `systemAuditContext` (FR2),
// so each hard-delete names the job that ran it.
//
// ── Idempotency ───────────────────────────────────────────────────────
// Re-running is a no-op: the eligibility reads return only rows that still
// exist in an eligible state, the deletes are scoped compare-and-set, and
// a row deleted between the list and the delete surfaces as a
// `DeletionError("not_found")` we treat as an already-done no-op. No
// duplicate rows, no duplicate audit events.
//
// ── Draft janitor (T-012) note ────────────────────────────────────────
// A draft has no completed version row and its S3 multipart upload id is
// never persisted (T-007), so the sweep can't `abortMultipartUpload` it —
// it purges the DB row and relies on the bucket's 7-day multipart
// auto-abort (design §Upload pipeline safety net / the T-001 lifecycle
// rule) to reclaim the incomplete S3 upload. Drafts are purged at 24h,
// long before their subroom (if any) could hit the 90-day archive window,
// so the archived-opportunity leg rarely sees a draft.

import { serializeError } from "@ai-data-room/api-utils/logging";
import type { Db } from "@ai-data-room/db";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { OrgRepo } from "../../infrastructure/db/orgRepo";
import type { S3DocumentStore } from "../../infrastructure/s3/client";
import { systemScope } from "../../infrastructure/db/scoped";
import { logger } from "../../infrastructure/logging/logger";
import { emitCount } from "../../infrastructure/observability/metrics";

import { systemAuditContext } from "../_audit-context";

import {
  DeletionError,
  hardDeleteDocument,
  SOFT_DELETE_RETENTION_DAYS,
  type HardDeleteDocumentDeps,
} from "./deletion";

/** Archived-subroom retention window (FR6 — 90 days, regulator-friendly). */
export const OPPORTUNITY_ARCHIVE_RETENTION_DAYS = 90;

/** Abandoned-draft max age before the janitor purges it (design §Upload). */
export const DRAFT_MAX_AGE_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The `systemScope` reason stamped on every hard-delete the sweep emits
 *  (rides into the audit trail as `metadata.reason`). */
const SWEEP_REASON = "retention_sweep";

export interface RetentionSweepInput {
  /** Injectable clock — the instant the retention cutoffs are measured
   *  against. Defaults to now; the integration test freezes it. */
  now?: Date;
}

export interface RetentionSweepDeps {
  db: Db;
  /** Cross-org registry — used ONLY to enumerate org ids to loop over
   *  (see the tenant-isolation note in the module header). */
  orgs: OrgRepo;
  /** Org-agnostic object store (S3 keys carry the org); shared across orgs. */
  store: S3DocumentStore;
  auditRepo: AuditRepo;
}

export interface RetentionSweepSummary {
  orgsSwept: number;
  /** Orgs whose sweep threw and was skipped (logged + metered). Keeps one
   *  org's failure from starving retention for every org ordered after it;
   *  the next scheduled run retries them (idempotent). */
  orgsFailed: number;
  documentsHardDeleted: number;
  opportunitiesHardDeleted: number;
  draftsPurged: number;
}

/**
 * Run one retention sweep across every org. Returns per-run counts (for
 * the handler's structured log + the idempotency assertion — a second run
 * on unchanged data returns all-zero counts).
 */
export async function runRetentionSweep(
  input: RetentionSweepInput,
  deps: RetentionSweepDeps,
): Promise<RetentionSweepSummary> {
  const now = input.now ?? new Date();
  const softDeleteCutoff = new Date(
    now.getTime() - SOFT_DELETE_RETENTION_DAYS * DAY_MS,
  );
  const archiveCutoff = new Date(
    now.getTime() - OPPORTUNITY_ARCHIVE_RETENTION_DAYS * DAY_MS,
  );
  const draftCutoff = new Date(now.getTime() - DRAFT_MAX_AGE_HOURS * HOUR_MS);

  const orgIds = await deps.orgs.listAllIds();
  const summary: RetentionSweepSummary = {
    orgsSwept: 0,
    orgsFailed: 0,
    documentsHardDeleted: 0,
    opportunitiesHardDeleted: 0,
    draftsPurged: 0,
  };

  for (const orgId of orgIds) {
    // Per-org boundary: an unexpected throw (a DB error, an FK violation on
    // an opportunity delete) skips THIS org and is logged/metered, rather
    // than aborting the whole run and starving every higher-id org's
    // retention. `not_found` races are already swallowed in `hardDeleteOne`.
    try {
      await sweepOrg(
        orgId,
        { softDeleteCutoff, archiveCutoff, draftCutoff },
        deps,
        summary,
      );
      summary.orgsSwept += 1;
    } catch (err) {
      summary.orgsFailed += 1;
      emitCount("room.retention.org_failure");
      logger.error("room.retention.org_failed", {
        orgId,
        error: serializeError(err),
      });
    }
  }

  emitCount(
    "room.retention.documents_hard_deleted",
    summary.documentsHardDeleted,
  );
  emitCount(
    "room.retention.opportunities_hard_deleted",
    summary.opportunitiesHardDeleted,
  );
  emitCount("room.retention.drafts_purged", summary.draftsPurged);
  logger.info("room.retention.sweep_complete", { ...summary });

  return summary;
}

interface SweepCutoffs {
  softDeleteCutoff: Date;
  archiveCutoff: Date;
  draftCutoff: Date;
}

/** Sweep a single org under its own `systemScope`. Mutates `summary`'s
 *  counters. Throws propagate to the per-org boundary in
 *  `runRetentionSweep`. */
async function sweepOrg(
  orgId: string,
  cutoffs: SweepCutoffs,
  deps: RetentionSweepDeps,
  summary: RetentionSweepSummary,
): Promise<void> {
  const { softDeleteCutoff, archiveCutoff, draftCutoff } = cutoffs;
  const scope = systemScope(orgId, deps.db, { reason: SWEEP_REASON });
  const sysCtx = systemAuditContext(scope.audit);
  // hardDeleteDocument takes an AuditContext (sourceIp/userAgent); the
  // system loopback pair marks the event as system-originated, and
  // `auditMetadata` carries the `{ actor, reason }` attribution (FR2).
  const audit = { sourceIp: sysCtx.sourceIp, userAgent: sysCtx.userAgent };
  const auditMetadata = sysCtx.metadata;
  const hardDeleteDeps: HardDeleteDocumentDeps = {
    db: deps.db,
    documents: scope.repos.documents,
    documentVersions: scope.repos.documentVersions,
    documentDeletions: scope.repos.documentDeletions,
    store: deps.store,
    auditRepo: deps.auditRepo,
  };

  const hardDeleteOne = async (documentId: string): Promise<boolean> => {
    try {
      await hardDeleteDocument(
        { documentId, actorUserId: null, audit, auditMetadata },
        hardDeleteDeps,
      );
      return true;
    } catch (err) {
      // Raced with a concurrent delete (or a prior sweep) between the
      // eligibility read and here — idempotent no-op, not a failure.
      if (err instanceof DeletionError && err.reason === "not_found") {
        return false;
      }
      throw err;
    }
  };

  // 1. Documents soft-deleted past the 30-day window (FR17).
  const expiredSoftDeleted =
    await scope.repos.documents.listSoftDeletedBefore(softDeleteCutoff);
  for (const doc of expiredSoftDeleted) {
    if (await hardDeleteOne(doc.id)) summary.documentsHardDeleted += 1;
  }

  // 2. Opportunity subrooms archived past the 90-day window (FR6): purge
  //    every document in the subroom, then the opportunity row.
  const expiredArchived =
    await scope.repos.opportunities.listArchivedBefore(archiveCutoff);
  for (const opp of expiredArchived) {
    const docs = await scope.repos.documents.listAllByOpportunity(opp.id);
    for (const doc of docs) {
      if (await hardDeleteOne(doc.id)) summary.documentsHardDeleted += 1;
    }
    const deleted = await scope.repos.opportunities.hardDelete(opp.id);
    if (deleted) summary.opportunitiesHardDeleted += 1;
  }

  // 3. Abandoned drafts older than 24h (T-012 janitor). A draft has no
  //    version/forensic footprint — `purgeDraft` is a compare-and-set on
  //    `state='draft'`, so a draft completed mid-sweep is preserved
  //    (never destroyed unaudited).
  const expiredDrafts =
    await scope.repos.documents.listExpiredDraftsBefore(draftCutoff);
  for (const draft of expiredDrafts) {
    const purged = await scope.repos.documents.purgeDraft(draft.id);
    if (purged) summary.draftsPurged += 1;
  }
}
