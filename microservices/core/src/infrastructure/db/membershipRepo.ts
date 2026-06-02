// Drizzle-backed repository for the `org_memberships` aggregate.
//
// Slice 1 / T-007. Conventions per `userRepo.ts`. Used by the signup
// callback (T-008) to attach the first internal user as `owner`,
// the suspension flow (T-012) to enforce sole-owner-cannot-be-
// suspended, and the role-change audit emitter (T-013).

import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  OrgMembership,
  Role,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { firstOrNull } from "./_helpers";

const { orgMemberships } = schema;

export interface CreateMembershipInput {
  orgId: string;
  userId: string;
  role: Role;
}

export class MembershipRepo {
  private readonly db: DbOrTx;
  constructor(db: DbOrTx) {
    this.db = db;
  }

  withTx(tx: Tx): MembershipRepo {
    return new MembershipRepo(tx);
  }

  /**
   * Inserts a fresh membership. The `(org_id, user_id)` unique index
   * blocks duplicates; the partial-unique `WHERE role = 'owner'`
   * (T-005) blocks a second owner on the same org. Both surface as
   * an exception that the application layer (T-008/T-009) catches
   * and translates into a domain error.
   */
  async create(input: CreateMembershipInput): Promise<OrgMembership> {
    const [row] = await this.db
      .insert(orgMemberships)
      .values(input)
      .returning();
    return row as OrgMembership;
  }

  /**
   * The (single) membership for a user, or null. The v0.1
   * single-membership invariant (one org per user) means at most one
   * row exists; `org-provisioning`'s `createOrg` (slice 17 / T-002)
   * uses this to enforce FR5 — reject a second org for a user who
   * already belongs to one.
   */
  async findByUser(userId: string): Promise<OrgMembership | null> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.userId, userId));
    return firstOrNull(rows as OrgMembership[]);
  }

  /**
   * Transaction-scoped advisory lock serialising concurrent create-org
   * attempts for one user (org-provisioning FR5). There is deliberately
   * no `UNIQUE(user_id)` on `org_memberships` — multi-membership is a
   * future option — so two `POST /orgs` from the same user landing in
   * the same instant could otherwise both pass the single-membership
   * `findByUser` guard and create two orgs. `createOrg` takes this lock
   * at the top of its transaction, then re-checks `findByUser` inside
   * it: the second caller blocks here until the first commits, then
   * sees the membership and aborts. The lock is released automatically
   * on commit/rollback. Call on a tx-bound repo (`withTx`) — on the
   * pool it would release at statement end and serialise nothing.
   *
   * `hashtext` maps the UUID to the int key `pg_advisory_xact_lock`
   * needs; a hash collision only over-serialises two unrelated users
   * (a rare, harmless extra wait), never a correctness problem.
   */
  async lockForUserCreate(userId: string): Promise<void> {
    await this.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`,
    );
  }

  async findByOrgUser(
    orgId: string,
    userId: string,
  ): Promise<OrgMembership | null> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(
        and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
      );
    return firstOrNull(rows as OrgMembership[]);
  }

  /**
   * All memberships for an org. Used by the suspension flow to
   * determine "is this user the only owner?" and by admin dashboard
   * roster views.
   */
  async listByOrg(orgId: string): Promise<OrgMembership[]> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.orgId, orgId));
    return rows as OrgMembership[];
  }

  /**
   * Convenience for the FR23 "sole owner cannot be suspended" check.
   * Returns the single owner row (the partial unique index guarantees
   * at most one) or null if the org somehow has no owner — that's a
   * data-integrity bug the caller should treat as 500-class.
   */
  async findOwnerForOrg(orgId: string): Promise<OrgMembership | null> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(
        and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "owner")),
      );
    return firstOrNull(rows as OrgMembership[]);
  }
}
