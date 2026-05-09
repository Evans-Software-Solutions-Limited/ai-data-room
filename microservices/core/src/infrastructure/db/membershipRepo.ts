// Drizzle-backed repository for the `org_memberships` aggregate.
//
// Slice 1 / T-007. Conventions per `userRepo.ts`. Used by the signup
// callback (T-008) to attach the first internal user as `owner`,
// the suspension flow (T-012) to enforce sole-owner-cannot-be-
// suspended, and the role-change audit emitter (T-013).

import { and, eq } from "drizzle-orm";
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
