// TenantBootstrapRepo — reads that legitimately run BEFORE a tenant
// context exists.
//
// Tenant-isolation (slice 10) / T-004. Mirrors `userRepo.ts`'s shape
// (plain constructor, no `ScopedRepo` base) for the same reason
// `userRepo` is exempt (FR7 / design.md "Identity & the bootstrap
// path"): each method here is a lookup that has to run BEFORE the
// caller knows which org it's operating under, so it can't be routed
// through `scopedRepo(orgId)` without a chicken-and-egg deadlock —
// you need the row to DISCOVER the org, so you can't demand the org
// up front. Concretely:
//
//   - `findMembershipForUser` / `lockForUserCreate` — moved here
//     (verbatim, from `membershipRepo.ts`'s pre-T-004
//     `findByUser` / `lockForUserCreate`). `resolveActor`'s
//     membership fallback and `createOrg`'s FR5 "does this user
//     already belong to an org" guard both ask this question before
//     any org is known — that's literally what they're trying to
//     discover.
//   - `findInvitationByWorkosId` — moved here (verbatim, from
//     `invitationRepo.ts`'s pre-T-004 `findByWorkosInvitationId`).
//     The WorkOS webhook hands `acceptInvitation` an invitation id and
//     nothing else; the invitation row (once found) is what reveals
//     `orgId`, so the lookup itself can't be org-scoped.
//   - `listGrantsForUser` — moved here (verbatim, from
//     `externalGrantRepo.ts`'s pre-T-004 `listByUser`). `/me`'s
//     self-read of `opportunityScopes[]` has to work for external
//     users, who have zero `org_memberships` rows and therefore never
//     get a `localOrgId` / `scopedRepo` handle at all (design.md
//     "External actors (no membership)").
//
// NOT exported from `scopedRepo()` and NOT a `ScopedRepo` subclass —
// it has no bound org, by design. Each method is still safe unscoped
// because it's keyed to a single USER (their own row) or a single
// externally-issued, unguessable WorkOS id — never "give me org A's
// rows", which is the operation this slice actually needs to guard.

import { eq, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  ExternalAccessGrant,
  Invitation,
  OrgMembership,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { firstOrNull } from "./_helpers";

const { externalAccessGrants, invitations, orgMemberships } = schema;

export class TenantBootstrapRepo {
  private readonly db: DbOrTx;
  constructor(db: DbOrTx) {
    this.db = db;
  }

  /**
   * Returns a new instance bound to a Drizzle transaction handle —
   * same shape as every other T-007 repo's `withTx`, so
   * `createOrg`'s in-tx advisory-lock + race-recheck sequence keeps
   * working unchanged.
   */
  withTx(tx: Tx): TenantBootstrapRepo {
    return new TenantBootstrapRepo(tx);
  }

  /**
   * The (single) membership for a user, or null. The v0.1
   * single-membership invariant (one org per user) means at most one
   * row exists. Two bootstrap callers: `resolveActor`'s membership
   * fallback (the WorkOS session carries no org yet, but the user may
   * have just created one via `POST /orgs`) and `createOrg`'s pre-tx
   * FR5 guard (org-provisioning) — both need "does this user already
   * belong to an org" before any org is known.
   */
  async findMembershipForUser(userId: string): Promise<OrgMembership | null> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.userId, userId));
    return firstOrNull(rows as OrgMembership[]);
  }

  /**
   * Transaction-scoped advisory lock serialising concurrent create-org
   * attempts for one user (org-provisioning FR5). There is
   * deliberately no `UNIQUE(user_id)` on `org_memberships`
   * (multi-membership is a future option), so two `POST /orgs` from
   * the same user landing in the same instant could otherwise both
   * pass the single-membership `findMembershipForUser` guard and
   * create two orgs. `createOrg` takes this lock at the top of its
   * transaction, then re-checks `findMembershipForUser` inside it:
   * the second caller blocks here until the first commits, then sees
   * the membership and aborts. The lock is released automatically on
   * commit/rollback. Call on a tx-bound repo (`withTx`) — on the pool
   * it would release at statement end and serialise nothing.
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

  /**
   * The webhook handler receives the WorkOS invitation id and needs to
   * look up our local row — including its `orgId` — BEFORE any tenant
   * context exists. Once `acceptInvitation` has the row, it binds
   * `scopedRepo(invitation.orgId, tx)` for every subsequent write
   * inside the same transaction.
   */
  async findInvitationByWorkosId(
    workosInvitationId: string,
  ): Promise<Invitation | null> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(eq(invitations.workosInvitationId, workosInvitationId));
    return firstOrNull(rows as Invitation[]);
  }

  /**
   * Every grant for a user, across every org they've been granted
   * access to. `/me`'s self-read of `opportunityScopes[]` — an
   * external user has zero memberships, so `resolveActor` gives them
   * no `localOrgId` and hence no `scopedRepo` handle at all. Safe
   * unscoped because the caller can only ever read their OWN grants
   * (keyed by `userId`), never another user's.
   */
  async listGrantsForUser(userId: string): Promise<ExternalAccessGrant[]> {
    const rows = await this.db
      .select()
      .from(externalAccessGrants)
      .where(eq(externalAccessGrants.userId, userId));
    return rows as ExternalAccessGrant[];
  }
}
