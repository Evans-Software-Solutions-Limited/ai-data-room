// Application-layer Opportunity CRUD — room-and-folders (slice 2) / T-006.
//
// Covers FR4 (create), FR5 (rename), FR6 (archive), FR7 (list) and FR19
// (audit every mutation). Follows the `invitations.ts` shape: deps carry
// the caller's already-scoped repos (`ctx.scoped.opportunities` /
// `ctx.scoped.externalGrants`), not the whole `ScopedRepos` bundle.
//
// Archive-triggered external-grant revocation is owned HERE, not by
// access-control (which hasn't shipped yet) — see ADR-014
// (`adr/014-archive-triggered-grant-revocation.md`): `archiveOpportunity`
// revokes the archived subroom's active grants in the same transaction
// as the archive, via `ExternalGrantRepo.revokeActiveForOpportunity`.

import type { Db } from "@ai-data-room/db";
import {
  OpportunitySlugSchema,
  type Opportunity,
} from "@ai-data-room/api-utils/schemas/rooms";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { ExternalGrantRepo } from "../../infrastructure/db/externalGrantRepo";
import type { OpportunityRepo } from "../../infrastructure/db/opportunityRepo";

import { type AuditContext, safeAudit } from "../_audit-context";

export type OpportunityErrorReason =
  /** Slug failed `OpportunitySlugSchema` validation — pure input error,
   * no audit is written (mirrors the schema-validation-first pattern
   * elsewhere in the application layer). */
  | "invalid_slug"
  /** `(org_id, slug)` uniqueness violated — either caught by the
   * pre-check `findBySlug` read, or translated from the DB's 23505
   * unique-violation when a concurrent create/rename wins the race. */
  | "slug_taken"
  /** Lookup miss on rename / archive — unknown id or belongs to a
   * foreign org (the scoped repo makes those indistinguishable). */
  | "not_found"
  /** Archive requested against an opportunity that is already
   * `archived` — FR6 is "archive an active subroom". */
  | "already_archived";

export class OpportunityError extends Error {
  public readonly reason: OpportunityErrorReason;
  constructor(reason: OpportunityErrorReason) {
    super(reason);
    this.name = "OpportunityError";
    this.reason = reason;
  }
}

/** True for the Postgres unique-violation (23505) on the `(org_id, slug)`
 * index. postgres.js surfaces the SQLSTATE as `.code` on the thrown
 * error. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

// ---------------------------------------------------------------------------
// createOpportunity
// ---------------------------------------------------------------------------

export interface CreateOpportunityInput {
  slug: string;
  /** Display name; defaults to `slug` when omitted or blank. */
  name?: string;
  actorUserId: string;
  audit: AuditContext;
}

export interface CreateOpportunityDeps {
  db: Db;
  opportunities: OpportunityRepo;
  auditRepo: AuditRepo;
}

export async function createOpportunity(
  input: CreateOpportunityInput,
  deps: CreateOpportunityDeps,
): Promise<Opportunity> {
  const parsed = OpportunitySlugSchema.safeParse(input.slug);
  if (!parsed.success) {
    // Pure input validation — no audit (matches the invalid_slug shape
    // used on rename below, and the schema-validation-first pattern
    // elsewhere in the application layer).
    throw new OpportunityError("invalid_slug");
  }
  const slug = parsed.data;
  const name = input.name?.trim() ? input.name.trim() : slug;

  // Pre-check: gives a clean slug_taken before hitting the unique-index
  // exception in the common case.
  if (await deps.opportunities.findBySlug(slug)) {
    await safeAudit(deps, {
      eventType: "opportunity_created",
      outcome: "failure",
      actorUserId: input.actorUserId,
      orgId: deps.opportunities.scopeOrgId,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: { slug, reason: "slug_taken" },
    });
    throw new OpportunityError("slug_taken");
  }

  let created: Opportunity;
  try {
    created = await deps.opportunities.create({
      slug,
      name,
      createdBy: input.actorUserId,
    });
  } catch (err) {
    // The findBySlug pre-check above doesn't close the race against a
    // concurrent create of the same slug — the unique index is the
    // backstop, translated here to the same domain error + audit shape.
    if (isUniqueViolation(err)) {
      await safeAudit(deps, {
        eventType: "opportunity_created",
        outcome: "failure",
        actorUserId: input.actorUserId,
        orgId: deps.opportunities.scopeOrgId,
        sourceIp: input.audit.sourceIp,
        userAgent: input.audit.userAgent,
        metadata: { slug, reason: "slug_taken" },
      });
      throw new OpportunityError("slug_taken");
    }
    throw err;
  }

  await safeAudit(deps, {
    eventType: "opportunity_created",
    outcome: "success",
    actorUserId: input.actorUserId,
    orgId: created.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { opportunityId: created.id, slug },
  });

  return created;
}

// ---------------------------------------------------------------------------
// renameOpportunity
// ---------------------------------------------------------------------------

export interface RenameOpportunityInput {
  id: string;
  slug: string;
  /** Display name; defaults to `slug` when omitted or blank. */
  name?: string;
  actorUserId: string;
  audit: AuditContext;
}

export interface RenameOpportunityDeps {
  db: Db;
  opportunities: OpportunityRepo;
  // Needed to re-key external grants when the slug changes (FR5 — rename
  // preserves grants). See ADR-014 + `retargetOpportunitySlug`.
  externalGrants: ExternalGrantRepo;
  auditRepo: AuditRepo;
}

export async function renameOpportunity(
  input: RenameOpportunityInput,
  deps: RenameOpportunityDeps,
): Promise<Opportunity> {
  const parsed = OpportunitySlugSchema.safeParse(input.slug);
  if (!parsed.success) {
    throw new OpportunityError("invalid_slug");
  }
  const slug = parsed.data;
  const name = input.name?.trim() ? input.name.trim() : slug;

  // Rename + grant re-key are atomic. The OLD slug (the retarget's join
  // key) is read INSIDE the tx, not before it — a concurrent rename of
  // the same subroom committing in the gap would otherwise leave
  // `existing.slug` stale and strand the grants under a slug the retarget
  // never matches. See ADR-014. FR5: rename preserves grants by moving
  // them to the new slug so a later archive (which revokes by current
  // slug) still finds them.
  let result:
    | { kind: "ok"; opportunity: Opportunity; oldSlug: string }
    | { kind: "not_found" };
  try {
    result = await deps.db.transaction(async (tx) => {
      const oppsTx = deps.opportunities.withTx(tx);
      const current = await oppsTx.findById(input.id);
      if (!current) return { kind: "not_found" as const };
      const row = await oppsTx.rename(input.id, { slug, name });
      // Null after a positive read = lost a race with a concurrent
      // delete/archive; surface the same not_found as an unknown id.
      if (!row) return { kind: "not_found" as const };
      if (current.slug !== slug) {
        await deps.externalGrants
          .withTx(tx)
          .retargetOpportunitySlug(current.slug, slug);
      }
      return { kind: "ok" as const, opportunity: row, oldSlug: current.slug };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      await safeAudit(deps, {
        eventType: "opportunity_renamed",
        outcome: "failure",
        actorUserId: input.actorUserId,
        orgId: deps.opportunities.scopeOrgId,
        sourceIp: input.audit.sourceIp,
        userAgent: input.audit.userAgent,
        metadata: { opportunityId: input.id, slug, reason: "slug_taken" },
      });
      throw new OpportunityError("slug_taken");
    }
    throw err;
  }

  if (result.kind === "not_found") {
    await safeAudit(deps, {
      eventType: "opportunity_renamed",
      outcome: "failure",
      actorUserId: input.actorUserId,
      orgId: deps.opportunities.scopeOrgId,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: { opportunityId: input.id, reason: "not_found" },
    });
    throw new OpportunityError("not_found");
  }

  await safeAudit(deps, {
    eventType: "opportunity_renamed",
    outcome: "success",
    actorUserId: input.actorUserId,
    orgId: result.opportunity.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      opportunityId: result.opportunity.id,
      oldSlug: result.oldSlug,
      newSlug: slug,
    },
  });

  return result.opportunity;
}

// ---------------------------------------------------------------------------
// archiveOpportunity
// ---------------------------------------------------------------------------

export interface ArchiveOpportunityInput {
  id: string;
  actorUserId: string;
  audit: AuditContext;
}

export interface ArchiveOpportunityDeps {
  db: Db;
  opportunities: OpportunityRepo;
  externalGrants: ExternalGrantRepo;
  auditRepo: AuditRepo;
}

export interface ArchiveOpportunityResult {
  opportunity: Opportunity;
  grantsRevoked: number;
}

export async function archiveOpportunity(
  input: ArchiveOpportunityInput,
  deps: ArchiveOpportunityDeps,
): Promise<ArchiveOpportunityResult> {
  // Pre-check outside the tx: gives precise not_found / already_archived
  // errors + a failure audit without needing a transaction at all.
  const existing = await deps.opportunities.findById(input.id);
  if (!existing) {
    await safeAudit(deps, {
      eventType: "opportunity_archived",
      outcome: "failure",
      actorUserId: input.actorUserId,
      orgId: deps.opportunities.scopeOrgId,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: { opportunityId: input.id, reason: "not_found" },
    });
    throw new OpportunityError("not_found");
  }
  if (existing.status !== "active") {
    await safeAudit(deps, {
      eventType: "opportunity_archived",
      outcome: "failure",
      actorUserId: input.actorUserId,
      orgId: existing.orgId,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: { opportunityId: input.id, reason: "already_archived" },
    });
    throw new OpportunityError("already_archived");
  }

  // Archive + archive-triggered grant revocation (ADR-014) are atomic:
  // one transaction, so a subroom can never end up archived with its
  // external grants still active (or vice versa).
  const { opportunity, grantsRevoked } = await deps.db.transaction(
    async (tx) => {
      const archived = await deps.opportunities.withTx(tx).archive(input.id);
      if (!archived) {
        // Lost a race with a concurrent archive between the pre-check
        // and this compare-and-set update.
        throw new OpportunityError("already_archived");
      }
      // Revoke by the slug on the row `archive()` just returned, NOT the
      // pre-tx `existing.slug` — the latter is read outside the tx and a
      // concurrent rename could have moved the grants to a new slug.
      const revoked = await deps.externalGrants
        .withTx(tx)
        .revokeActiveForOpportunity(archived.slug);
      return { opportunity: archived, grantsRevoked: revoked };
    },
  );

  await safeAudit(deps, {
    eventType: "opportunity_archived",
    outcome: "success",
    actorUserId: input.actorUserId,
    orgId: opportunity.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      opportunityId: opportunity.id,
      slug: opportunity.slug,
      grantsRevoked,
    },
  });

  return { opportunity, grantsRevoked };
}

// ---------------------------------------------------------------------------
// listOpportunities
// ---------------------------------------------------------------------------

export interface ListOpportunitiesDeps {
  opportunities: OpportunityRepo;
}

/** Read-only — no audit emission (not in FR19's mutation list). */
export async function listOpportunities(
  deps: ListOpportunitiesDeps,
): Promise<Opportunity[]> {
  return deps.opportunities.listActive();
}
