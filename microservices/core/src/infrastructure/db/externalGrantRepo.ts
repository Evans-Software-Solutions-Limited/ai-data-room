// Drizzle-backed repository for the `external_access_grants` aggregate.
//
// Slice 1 / T-007. Conventions per `userRepo.ts`. Used at invite-accept
// time (T-009) to create the grant for an external user, and by the
// `/me` handler (T-015) to populate `opportunityScopes[]`.
//
// Revocation lives in the access-control slice (slice 3); this slice
// only exposes the create + read surface that auth-and-orgs needs.

import { eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type { ExternalAccessGrant } from "@ai-data-room/api-utils/schemas/auth-orgs";

const { externalAccessGrants } = schema;

export interface CreateExternalGrantInput {
  orgId: string;
  userId: string;
  opportunitySlug: string;
  grantedBy: string;
  /** FR8b — diligence-bounded grants. Caller (`acceptInvitation`)
   * computes the timestamp from the FR8b 90-day default. The DB
   * column also carries a 90-day default as a defence-in-depth
   * backstop, but the application layer is the policy owner. */
  expiresAt: Date;
}

export class ExternalGrantRepo {
  private readonly db: DbOrTx;
  constructor(db: DbOrTx) {
    this.db = db;
  }

  withTx(tx: Tx): ExternalGrantRepo {
    return new ExternalGrantRepo(tx);
  }

  async create(input: CreateExternalGrantInput): Promise<ExternalAccessGrant> {
    const [row] = await this.db
      .insert(externalAccessGrants)
      .values(input)
      .returning();
    return row as ExternalAccessGrant;
  }

  /**
   * Used by `/me` to populate `opportunityScopes[]` for external
   * users. Returns all grants (active + revoked) — the application
   * layer filters to `status = 'active'` so revocation history is
   * still visible to admin tooling.
   */
  async listByUser(userId: string): Promise<ExternalAccessGrant[]> {
    const rows = await this.db
      .select()
      .from(externalAccessGrants)
      .where(eq(externalAccessGrants.userId, userId));
    return rows as ExternalAccessGrant[];
  }

  /**
   * Org-side roster: all external users with grants under this org.
   * Useful for admin tooling enumerating "which vendors have access".
   */
  async listByOrg(orgId: string): Promise<ExternalAccessGrant[]> {
    const rows = await this.db
      .select()
      .from(externalAccessGrants)
      .where(eq(externalAccessGrants.orgId, orgId));
    return rows as ExternalAccessGrant[];
  }
}
