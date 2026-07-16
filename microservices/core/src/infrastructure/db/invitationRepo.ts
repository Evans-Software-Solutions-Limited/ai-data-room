// Drizzle-backed repository for the `invitations` aggregate.
//
// Slice 1 / T-007. Conventions per `userRepo.ts`. Tenant-isolation
// (slice 10) / T-004 backfilled this onto `ScopedRepo` (FR7): every
// read is scoped to the org this instance is bound to, every write
// stamps it. `findByWorkosInvitationId` moved verbatim to
// `bootstrapRepo.ts` (`TenantBootstrapRepo`) — the WorkOS webhook
// accept path discovers the invitation (and therefore its org) BEFORE
// any tenant context exists, so it can't be scoped by an org that
// isn't known yet. See design.md "Identity & the bootstrap path".
//
// Used by the invitation flow (T-009 createInvitation /
// listInvitations / revokeInvitation / acceptInvitation).

import { and, eq } from "drizzle-orm";
import type { Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  Invitation,
  InvitationKind,
  InvitationRole,
  InvitationState,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { ScopedRepo } from "./scopedRepoBase";
import { emitCount } from "../observability/metrics";
import { firstOrNull, firstOrThrow } from "./_helpers";

const { invitations } = schema;

export interface CreateInvitationInput {
  workosInvitationId: string;
  email: string;
  kind: InvitationKind;
  role: InvitationRole | null;
  opportunitySlug: string | null;
  invitedBy: string;
  expiresAt: Date;
}

export class InvitationRepo extends ScopedRepo {
  withTx(tx: Tx): InvitationRepo {
    return new InvitationRepo(tx, this.orgId);
  }

  /**
   * Inserts a fresh invitation row into the bound org. The `(kind,
   * role, opportunitySlug)` invariant from design.md is enforced by
   * the zod schema (T-004) at the application boundary; this repo
   * trusts that and just persists.
   */
  async create(input: CreateInvitationInput): Promise<Invitation> {
    const [row] = await this.db
      .insert(invitations)
      .values(this.stampOrgId(input))
      .returning();
    return row as Invitation;
  }

  /**
   * Looks up an invitation by id within the bound org. A foreign-org
   * id resolves to `null` — the scoped predicate can't distinguish
   * "doesn't exist" from "exists in another org", which is exactly
   * the isolation guarantee this slice provides (see
   * `application/invitations.ts`'s `revokeInvitation` for the
   * consequence this has for its cross-org branch).
   */
  async findById(id: string): Promise<Invitation | null> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(this.scoped(invitations.orgId, eq(invitations.id, id)));
    return firstOrNull(rows as Invitation[]);
  }

  /**
   * `GET /orgs/:orgId/invitations?state=pending` lists outstanding
   * invites for the org admin UI. The `(org_id, state)` btree index
   * (T-003 migration) makes this O(log n). Org is implicit (was
   * `listByOrgAndState(orgId, state)` pre-T-004).
   */
  async listByState(state: InvitationState): Promise<Invitation[]> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(this.scoped(invitations.orgId, eq(invitations.state, state)));
    return rows as Invitation[];
  }

  /**
   * State transitions (`pending → accepted | revoked | expired`) are
   * the only mutations on this aggregate. `acceptedAt` is captured
   * inside this method when the new state is `accepted` so callers
   * don't have to remember the join. Scoped to the bound org — a
   * foreign-org id matches zero rows and `firstOrThrow` throws, same
   * as a genuinely missing id.
   */
  async setState(id: string, state: InvitationState): Promise<Invitation> {
    const now = new Date();
    const rows = await this.db
      .update(invitations)
      .set({
        state,
        acceptedAt: state === "accepted" ? now : null,
        updatedAt: now,
      })
      .where(this.scoped(invitations.orgId, eq(invitations.id, id)))
      .returning();
    return firstOrThrow(rows as Invitation[], "Invitation", id);
  }

  /**
   * Atomic compare-and-set: transitions `state` only if the row is
   * currently in `expectedState` AND within the bound org. Returns
   * the updated row on success, `null` if another concurrent caller
   * already moved the state (or the id belongs to a foreign org).
   *
   * The application layer uses this to close the TOCTOU race between
   * the read-state check and the write — without the WHERE clause,
   * two concurrent `acceptInvitation` deliveries could both pass a
   * pre-transaction `state === "pending"` check and both proceed to
   * create grants, and a concurrent `revokeInvitation` could clobber
   * an in-flight accept (and vice versa).
   */
  async transitionState(
    id: string,
    expectedState: InvitationState,
    newState: InvitationState,
  ): Promise<Invitation | null> {
    const now = new Date();
    const rows = await this.db
      .update(invitations)
      .set({
        state: newState,
        acceptedAt: newState === "accepted" ? now : null,
        updatedAt: now,
      })
      .where(
        this.scoped(
          invitations.orgId,
          and(eq(invitations.id, id), eq(invitations.state, expectedState)),
        ),
      )
      .returning();
    const result = firstOrNull(rows as Invitation[]);

    // Emit the expiry metric here (not at the call site) because all
    // transitions to `expired` flow through this method — including
    // the future sweeper cron that hasn't shipped yet. `accepted`
    // and `revoked` get their own metrics emitted alongside their
    // audit writes; emitting them here too would double-count.
    if (result && newState === "expired") {
      emitCount("auth.invite.expired");
    }

    return result;
  }
}
