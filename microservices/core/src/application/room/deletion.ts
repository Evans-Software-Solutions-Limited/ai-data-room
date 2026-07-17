// Application-layer document deletion lifecycle — room-and-folders
// (slice 2) / T-009.
//
// Covers FR17 (soft-delete + restore within a 30-day retention window) and
// FR18 (hard-delete — the irreversible, support-only removal). Follows the
// `upload.ts` / `opportunities.ts` shape: a `deps` object of already-scoped
// repos, a domain `DeletionError` with a reason union, `safeAudit` on every
// outcome (FR19).
//
// ── Design notes (flagged in PR) ──────────────────────────────────────
//
// 1. **Hard-delete TAGS the S3 objects, it doesn't delete the bytes.**
//    Per design §Storage layout the docs bucket has a lifecycle rule that
//    reclaims objects tagged `state=hard-deleted` after a 7-day ops grace
//    (T-001, deferred to deploy). So `hardDeleteDocument` marks each
//    version's object for reclaim via `store.tagObject` rather than issuing
//    a `deleteObject` — the DB row removal is the authoritative deletion;
//    the tag is a lazy-reclaim hint that preserves the recovery buffer.
//
// 2. **Hard-delete does its DB writes FIRST, then tags S3.** This inverts
//    the external-calls-first ordering of `upload`/`createOrg` — and
//    deliberately so. Those flows put the external call first because their
//    DB write DEPENDS on its result (the sha256, the WorkOS org id); here
//    there is no such dependency, and external-first would be actively
//    unsafe: if the DB tx then failed, we'd have tagged the objects of a
//    still-live document for reclaim, and the lifecycle rule would silently
//    delete a live document's bytes after 7 days. DB-first fails safe — a
//    post-commit tag failure only leaves un-reclaimed bytes (a storage
//    leak the sweep/janitor can reconcile), never live-document data loss.
//    Tag failures are therefore swallowed-and-logged (the `safeAudit`
//    philosophy) rather than thrown: the document IS hard-deleted once the
//    tx commits, so surfacing a 500 would be a lie that invites a retry
//    into `not_found`.

import { serializeError } from "@ai-data-room/api-utils/logging";
import type { Db } from "@ai-data-room/db";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { DocumentRepo } from "../../infrastructure/db/documentRepo";
import type { DocumentDeletionRepo } from "../../infrastructure/db/documentDeletionRepo";
import type { DocumentVersionRepo } from "../../infrastructure/db/documentVersionRepo";
import type { S3DocumentStore } from "../../infrastructure/s3/client";
import { logger } from "../../infrastructure/logging/logger";
import { emitCount } from "../../infrastructure/observability/metrics";

import { type AuditContext, safeAudit } from "../_audit-context";

/** Soft-delete retention window (FR17). A soft-deleted document can be
 *  restored for this many days; after that the retention sweep (T-010)
 *  hard-deletes it. Exported so the sweep computes eligibility from the
 *  same constant (one source of truth for the 30-day boundary). */
export const SOFT_DELETE_RETENTION_DAYS = 30;

const RETENTION_WINDOW_MS = SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** The S3 object-tag key/value the lifecycle rule (T-001) keys on to
 *  reclaim hard-deleted objects after its 7-day grace. */
const HARD_DELETED_TAG = { state: "hard-deleted" } as const;

export type DeletionErrorReason =
  /** Unknown id, or a document that belongs to a foreign org (the scoped
   *  repo makes those indistinguishable — never leak existence). */
  | "not_found"
  /** Soft-delete of a non-`active` document, restore of a non-`soft_deleted`
   *  document, or a compare-and-set that matched no row because the state
   *  changed under us (a concurrent transition lost the race). */
  | "invalid_state"
  /** Restore requested after the 30-day retention window has elapsed —
   *  the document is eligible for (or already past) the sweep. */
  | "retention_expired";

export class DeletionError extends Error {
  public readonly reason: DeletionErrorReason;
  constructor(reason: DeletionErrorReason) {
    super(reason);
    this.name = "DeletionError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// softDeleteDocument (FR17)
// ---------------------------------------------------------------------------

export interface SoftDeleteDocumentInput {
  documentId: string;
  actorUserId: string;
  audit: AuditContext;
  /** Injectable clock — the timestamp stamped as `soft_deleted_at` (starts
   *  the retention clock). Defaults to now; a caller (or test) can pin it. */
  now?: Date;
}

export interface SoftDeleteDocumentDeps {
  documents: DocumentRepo;
  auditRepo: AuditRepo;
}

/**
 * Soft-delete an active document: hide it from listings and start the
 * 30-day retention clock (FR17). A pre-check gives precise
 * `not_found` / `invalid_state` errors + a failure audit; the repo's
 * compare-and-set on `state='active'` is the race backstop.
 */
export async function softDeleteDocument(
  input: SoftDeleteDocumentInput,
  deps: SoftDeleteDocumentDeps,
): Promise<void> {
  const now = input.now ?? new Date();
  const orgId = deps.documents.scopeOrgId;

  const doc = await deps.documents.findById(input.documentId);
  if (!doc) {
    await auditFailure(deps, input, "file_soft_deleted", orgId, "not_found");
    throw new DeletionError("not_found");
  }
  if (doc.state !== "active") {
    await auditFailure(
      deps,
      input,
      "file_soft_deleted",
      orgId,
      "invalid_state",
    );
    throw new DeletionError("invalid_state");
  }

  const updated = await deps.documents.softDelete(input.documentId, now);
  if (!updated) {
    // Lost a race between the pre-check and the compare-and-set (a
    // concurrent soft-delete or upload flipped the state).
    await auditFailure(
      deps,
      input,
      "file_soft_deleted",
      orgId,
      "invalid_state",
    );
    throw new DeletionError("invalid_state");
  }

  await safeAudit(deps, {
    eventType: "file_soft_deleted",
    outcome: "success",
    actorUserId: input.actorUserId,
    orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { documentId: input.documentId },
  });
}

// ---------------------------------------------------------------------------
// restoreDocument (FR17)
// ---------------------------------------------------------------------------

export interface RestoreDocumentInput {
  documentId: string;
  actorUserId: string;
  audit: AuditContext;
  /** Injectable clock — "now" for the retention-window comparison.
   *  Defaults to now. */
  now?: Date;
}

export interface RestoreDocumentDeps {
  documents: DocumentRepo;
  auditRepo: AuditRepo;
}

/**
 * Restore a soft-deleted document, but only within its 30-day retention
 * window (FR17). The window check is the application layer's job — the repo
 * just reverses the transition. Boundary: a document is restorable while
 * `elapsed <= 30 days`, matching the sweep's `> 30 days` hard-delete
 * predicate (T-010) so there's no gap where a doc is neither restorable nor
 * yet swept.
 */
export async function restoreDocument(
  input: RestoreDocumentInput,
  deps: RestoreDocumentDeps,
): Promise<void> {
  const now = input.now ?? new Date();
  const orgId = deps.documents.scopeOrgId;

  const doc = await deps.documents.findById(input.documentId);
  if (!doc) {
    await auditFailure(deps, input, "file_restored", orgId, "not_found");
    throw new DeletionError("not_found");
  }
  if (doc.state !== "soft_deleted") {
    await auditFailure(deps, input, "file_restored", orgId, "invalid_state");
    throw new DeletionError("invalid_state");
  }

  // `soft_deleted_at` is always set when state is `soft_deleted`
  // (`softDelete` stamps it together). A null here would be a data
  // -integrity bug; we can't prove the window has elapsed from a missing
  // timestamp, so we fall through to allow restore (fail-open toward
  // recoverability, and consistent with the sweep, which also can't
  // compute `> 30d` without the timestamp).
  if (
    doc.softDeletedAt &&
    now.getTime() - doc.softDeletedAt.getTime() > RETENTION_WINDOW_MS
  ) {
    await auditFailure(
      deps,
      input,
      "file_restored",
      orgId,
      "retention_expired",
    );
    throw new DeletionError("retention_expired");
  }

  const restored = await deps.documents.restore(input.documentId);
  if (!restored) {
    // Lost a race (a concurrent restore, or the sweep hard-deleted it
    // between the pre-check and here).
    await auditFailure(deps, input, "file_restored", orgId, "invalid_state");
    throw new DeletionError("invalid_state");
  }

  await safeAudit(deps, {
    eventType: "file_restored",
    outcome: "success",
    actorUserId: input.actorUserId,
    orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { documentId: input.documentId },
  });
}

// ---------------------------------------------------------------------------
// hardDeleteDocument (FR18) — support-only, NOT handler-exposed at v0.1
// ---------------------------------------------------------------------------

export interface HardDeleteDocumentInput {
  documentId: string;
  /** The actor initiating the hard-delete — a support operator's id, or
   *  `null` for the retention sweep's system actor (T-010, no user).
   *  Recorded as the deletion record's `soft_deleted_by` (the attributable
   *  initiator of the deletion chain; `documents` doesn't track a separate
   *  soft-deleter, so a swept row's initiator is null). */
  actorUserId: string | null;
  audit: AuditContext;
  /** Extra audit metadata merged into the emitted events. The retention
   *  sweep passes `systemAuditContext(...).metadata` (`{ actor:"system",
   *  reason }`) so a system-initiated hard-delete names the job that ran it
   *  in the audit trail (the `systemScope` FR2 contract). */
  auditMetadata?: Record<string, unknown>;
}

export interface HardDeleteDocumentDeps {
  db: Db;
  documents: DocumentRepo;
  documentVersions: DocumentVersionRepo;
  documentDeletions: DocumentDeletionRepo;
  store: S3DocumentStore;
  auditRepo: AuditRepo;
}

/**
 * Irreversibly hard-delete a document (FR18). Support-only — deliberately
 * NOT wired to any handler at v0.1; called from support scripts and the
 * retention sweep (T-010). Writes a filename-free `document_deletions`
 * forensic row and removes the `documents` row (ON DELETE CASCADE drops its
 * versions) in one transaction, then tags each version's S3 object for
 * lifecycle reclaim. See the module header for the DB-first ordering
 * rationale.
 */
export async function hardDeleteDocument(
  input: HardDeleteDocumentInput,
  deps: HardDeleteDocumentDeps,
): Promise<void> {
  const orgId = deps.documents.scopeOrgId;

  const doc = await deps.documents.findById(input.documentId);
  if (!doc) {
    await auditFailure(deps, input, "file_hard_deleted", orgId, "not_found");
    throw new DeletionError("not_found");
  }

  // One transaction: list the versions (captures the exact set the cascade
  // will drop, from the tx snapshot), write the forensic row, delete the
  // document. `document_deletions` has no FK to `documents` (by design — it
  // outlives the row), so the ordering inside the tx is unconstrained.
  const versions = await deps.db
    .transaction(async (tx) => {
      const versionRows = await deps.documentVersions
        .withTx(tx)
        .listByDocument(input.documentId);
      await deps.documentDeletions.withTx(tx).create({
        documentId: input.documentId,
        softDeletedBy: input.actorUserId,
      });
      const deleted = await deps.documents
        .withTx(tx)
        .hardDelete(input.documentId);
      if (!deleted) {
        // Lost a race with a concurrent hard-delete between the pre-check and
        // here — roll back the forensic row we just wrote.
        throw new DeletionError("not_found");
      }
      return versionRows;
    })
    .catch(async (err: unknown) => {
      // Audit the lost-race failure before rethrowing so hard-delete honours
      // the same "audit every outcome" invariant as soft-delete / restore
      // (FR19). The audit write runs on the base repo (the tx has already
      // rolled back). Other errors are 500-class — they propagate unaudited,
      // surfaced via logs/metrics, matching upload.ts.
      if (err instanceof DeletionError && err.reason === "not_found") {
        await auditFailure(
          deps,
          input,
          "file_hard_deleted",
          orgId,
          "not_found",
        );
      }
      throw err;
    });

  // Mark every version's object for lifecycle reclaim (design §Storage
  // layout). Best-effort, post-commit: the document is already hard-deleted,
  // so a tag failure is a storage leak (reconciled by the sweep/janitor),
  // not a failed deletion. Swallow-and-log per version so one failure
  // doesn't abandon the rest.
  for (const version of versions) {
    try {
      await deps.store.tagObject(
        version.s3Key,
        HARD_DELETED_TAG,
        version.s3VersionId ?? undefined,
      );
    } catch (err) {
      emitCount("room.hard_delete.tag_failure");
      logger.error("room.hard_delete.tag_failure", {
        documentId: input.documentId,
        s3Key: version.s3Key,
        error: serializeError(err),
      });
    }
  }

  await safeAudit(deps, {
    eventType: "file_hard_deleted",
    outcome: "success",
    actorUserId: input.actorUserId,
    orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      ...(input.auditMetadata ?? {}),
      documentId: input.documentId,
      versionsDeleted: versions.length,
    },
  });
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

/** Emit a `failure`-outcome audit for a deletion transition. Kept local —
 *  the three flows share the exact same failure shape (`{ documentId,
 *  reason }` metadata), differing only in event type + reason. */
function auditFailure(
  deps: { auditRepo: AuditRepo },
  input: {
    documentId: string;
    actorUserId: string | null;
    audit: AuditContext;
    auditMetadata?: Record<string, unknown>;
  },
  eventType: "file_soft_deleted" | "file_restored" | "file_hard_deleted",
  orgId: string,
  reason: DeletionErrorReason,
): Promise<void> {
  return safeAudit(deps, {
    eventType,
    outcome: "failure",
    actorUserId: input.actorUserId,
    orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      ...(input.auditMetadata ?? {}),
      documentId: input.documentId,
      reason,
    },
  });
}
