// Drizzle-backed repository for the `invitations` aggregate.
//
// Slice 1 / T-007. Conventions per `userRepo.ts`. Used by the invitation
// flow (T-009 createInvitation / listInvitations / revokeInvitation /
// acceptInvitation).

import { and, eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  Invitation,
  InvitationKind,
  InvitationRole,
  InvitationState,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { firstOrNull, firstOrThrow } from "./_helpers";

const { invitations } = schema;

export interface CreateInvitationInput {
  workosInvitationId: string;
  orgId: string;
  email: string;
  kind: InvitationKind;
  role: InvitationRole | null;
  opportunitySlug: string | null;
  invitedBy: string;
  expiresAt: Date;
}

export class InvitationRepo {
  constructor(private readonly db: DbOrTx) {}

  withTx(tx: Tx): InvitationRepo {
    return new InvitationRepo(tx);
  }

  /**
   * Inserts a fresh invitation row. The `(kind, role, opportunitySlug)`
   * invariant from design.md is enforced by the zod schema (T-004) at
   * the application boundary; this repo trusts that and just persists.
   */
  async create(input: CreateInvitationInput): Promise<Invitation> {
    const [row] = await this.db.insert(invitations).values(input).returning();
    return row as Invitation;
  }

  async findById(id: string): Promise<Invitation | null> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, id));
    return firstOrNull(rows as Invitation[]);
  }

  /**
   * The webhook handler (T-016) receives the WorkOS invitation ID and
   * needs to look up our local row to update its state.
   */
  async findByWorkosInvitationId(
    workosInvitationId: string,
  ): Promise<Invitation | null> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(eq(invitations.workosInvitationId, workosInvitationId));
    return firstOrNull(rows as Invitation[]);
  }

  /**
   * `GET /orgs/:orgId/invitations?state=pending` lists outstanding
   * invites for the org admin UI. The `(org_id, state)` btree index
   * (T-003 migration) makes this O(log n).
   */
  async listByOrgAndState(
    orgId: string,
    state: InvitationState,
  ): Promise<Invitation[]> {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.orgId, orgId), eq(invitations.state, state)));
    return rows as Invitation[];
  }

  /**
   * State transitions (`pending → accepted | revoked | expired`) are
   * the only mutations on this aggregate. `acceptedAt` is captured
   * inside this method when the new state is `accepted` so callers
   * don't have to remember the join.
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
      .where(eq(invitations.id, id))
      .returning();
    return firstOrThrow(rows as Invitation[], "Invitation", id);
  }
}
