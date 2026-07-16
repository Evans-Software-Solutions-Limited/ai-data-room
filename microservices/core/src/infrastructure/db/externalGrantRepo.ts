// Drizzle-backed repository for the `external_access_grants` aggregate.
//
// Slice 1 / T-007. Conventions per `userRepo.ts`. Tenant-isolation
// (slice 10) / T-004 backfilled this onto `ScopedRepo` (FR7): every
// read is scoped to the org this instance is bound to, every write
// stamps it. `listByUser` moved verbatim to `bootstrapRepo.ts`
// (`TenantBootstrapRepo`) — `/me`'s self-read of the caller's own
// grants has to work for external users, who have zero memberships
// and therefore no `scopedRepo` handle at all (see design.md
// "External actors (no membership)").
//
// Access-control (slice 3) owns the user-facing revocation API, grant
// expiry, and access-time enforcement. The one exception is
// archive-triggered revocation (`revokeActiveForOpportunity`), added for
// room-and-folders FR6 per ADR-014: archiving an Opportunity revokes its
// active grants as an intrinsic part of that room operation, so it lives
// with the operation (and on this scoped repo, the tripwire-sanctioned
// home for writes to `external_access_grants`) rather than behind a
// cross-slice call into a slice that ships later.

import { and, eq } from "drizzle-orm";
import type { Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type { ExternalAccessGrant } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { ScopedRepo } from "./scopedRepoBase";

const { externalAccessGrants } = schema;

export interface CreateExternalGrantInput {
  userId: string;
  opportunitySlug: string;
  grantedBy: string;
  /** FR8b — diligence-bounded grants. Caller (`acceptInvitation`)
   * computes the timestamp from the FR8b 90-day default. The DB
   * column also carries a 90-day default as a defence-in-depth
   * backstop, but the application layer is the policy owner. */
  expiresAt: Date;
}

export class ExternalGrantRepo extends ScopedRepo {
  withTx(tx: Tx): ExternalGrantRepo {
    return new ExternalGrantRepo(tx, this.orgId);
  }

  async create(input: CreateExternalGrantInput): Promise<ExternalAccessGrant> {
    const [row] = await this.db
      .insert(externalAccessGrants)
      .values(this.stampOrgId(input))
      .returning();
    return row as ExternalAccessGrant;
  }

  /**
   * Org-side roster: all external users with grants under the bound
   * org. Useful for admin tooling enumerating "which vendors have
   * access". Org is implicit (was `listByOrg(orgId)` pre-T-004).
   */
  async list(): Promise<ExternalAccessGrant[]> {
    const rows = await this.db
      .select()
      .from(externalAccessGrants)
      .where(this.scoped(externalAccessGrants.orgId));
    return rows as ExternalAccessGrant[];
  }

  /**
   * Archive-triggered revocation (room-and-folders FR6, ADR-014): flips
   * every `active` grant scoped to `opportunitySlug` within the bound org
   * to `revoked`, stamping `updated_at`. Returns the number of grants
   * revoked (0 if the subroom had none). Room's `archiveOpportunity`
   * calls this in the same transaction as the archive. Already-`revoked`
   * / `expired` grants are left untouched by the `status = 'active'`
   * predicate, so a re-run is a no-op (idempotent).
   */
  async revokeActiveForOpportunity(opportunitySlug: string): Promise<number> {
    const rows = await this.db
      .update(externalAccessGrants)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(
        this.scoped(
          externalAccessGrants.orgId,
          and(
            eq(externalAccessGrants.opportunitySlug, opportunitySlug),
            eq(externalAccessGrants.status, "active"),
          ),
        ),
      )
      .returning();
    return rows.length;
  }

  /**
   * Re-key grants when their Opportunity subroom is renamed (FR5 —
   * "rename preserves grants"). Grants reference the subroom by its
   * MUTABLE `opportunity_slug` (a slice-1 shape), so without this a
   * rename would orphan every grant from its subroom and the
   * archive-triggered `revokeActiveForOpportunity` (which matches on the
   * current slug) would silently miss them. `renameOpportunity` calls
   * this in the same transaction as the rename. All statuses are
   * re-keyed — a grant references the same subroom whatever its state.
   * Slug is unique per org, so every matched row belongs to the one
   * renamed opportunity. Returns the number of grants re-keyed.
   *
   * NOTE (ADR-014 follow-up): the durable fix is an `opportunity_id` FK
   * on `external_access_grants` (revoke/enforce by id, not slug) — owned
   * by access-control (slice 3). Until then this keeps the slug join key
   * consistent across renames.
   */
  async retargetOpportunitySlug(
    fromSlug: string,
    toSlug: string,
  ): Promise<number> {
    const rows = await this.db
      .update(externalAccessGrants)
      .set({ opportunitySlug: toSlug, updatedAt: new Date() })
      .where(
        this.scoped(
          externalAccessGrants.orgId,
          eq(externalAccessGrants.opportunitySlug, fromSlug),
        ),
      )
      .returning();
    return rows.length;
  }
}
