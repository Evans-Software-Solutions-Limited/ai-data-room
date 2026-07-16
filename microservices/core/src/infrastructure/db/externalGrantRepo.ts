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
// Revocation lives in the access-control slice (slice 3); this slice
// only exposes the create + read surface that auth-and-orgs needs.

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
}
