// Drizzle-backed repository for the `org_memberships` aggregate.
//
// Slice 1 / T-007. Conventions per `userRepo.ts`. Tenant-isolation
// (slice 10) / T-004 backfilled this onto `ScopedRepo` (FR7): every
// read is scoped to the org this instance is bound to, every write
// stamps it. `findByUser` and `lockForUserCreate` moved verbatim to
// `bootstrapRepo.ts` (`TenantBootstrapRepo`) — they run BEFORE a
// tenant context exists (`resolveActor`'s membership fallback,
// `createOrg`'s pre-tx FR5 guard), so they can't be scoped by an org
// that isn't known yet. See design.md "Identity & the bootstrap path".
//
// Used by the suspension flow (T-012) to enforce sole-owner-cannot-be-
// suspended, and the role-change audit emitter (T-013).

import { eq } from "drizzle-orm";
import type { Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  OrgMembership,
  Role,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { ScopedRepo } from "./scopedRepoBase";
import { firstOrNull } from "./_helpers";

const { orgMemberships } = schema;

export interface CreateMembershipInput {
  userId: string;
  role: Role;
}

export class MembershipRepo extends ScopedRepo {
  withTx(tx: Tx): MembershipRepo {
    return new MembershipRepo(tx, this.orgId);
  }

  /**
   * Inserts a fresh membership into the bound org. The `(org_id,
   * user_id)` unique index blocks duplicates; the partial-unique
   * `WHERE role = 'owner'` (T-005) blocks a second owner on the same
   * org. Both surface as an exception that the application layer
   * (T-008/T-009) catches and translates into a domain error.
   */
  async create(input: CreateMembershipInput): Promise<OrgMembership> {
    const [row] = await this.db
      .insert(orgMemberships)
      .values(this.stampOrgId(input))
      .returning();
    return row as OrgMembership;
  }

  /**
   * The membership for this user within the bound org, or null.
   * `authorizeOrgAccess` and `/me` use this to resolve the actor's
   * role — org is implicit (the scope this repo is bound to), so
   * callers no longer pass it explicitly (was `findByOrgUser(orgId,
   * userId)` pre-T-004).
   */
  async findMember(userId: string): Promise<OrgMembership | null> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(
        this.scoped(orgMemberships.orgId, eq(orgMemberships.userId, userId)),
      );
    return firstOrNull(rows as OrgMembership[]);
  }

  /**
   * All memberships for the bound org. Used by the suspension flow to
   * determine "is this user the only owner?" and by admin dashboard
   * roster views.
   */
  async list(): Promise<OrgMembership[]> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(this.scoped(orgMemberships.orgId));
    return rows as OrgMembership[];
  }

  /**
   * Convenience for the FR23 "sole owner cannot be suspended" check.
   * Returns the single owner row (the partial unique index guarantees
   * at most one) or null if the org somehow has no owner — that's a
   * data-integrity bug the caller should treat as 500-class.
   */
  async findOwner(): Promise<OrgMembership | null> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(
        this.scoped(orgMemberships.orgId, eq(orgMemberships.role, "owner")),
      );
    return firstOrNull(rows as OrgMembership[]);
  }
}
