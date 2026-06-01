// DELETE /orgs/:orgId/invitations/:id — revoke a pending invitation
// per FR10.
//
// Slice 1 / T-014b. Wraps `revokeInvitation` from the application
// layer. Authorization: cross-org guard + owner-or-editor role.
//
// `revokeInvitation` itself enforces the cross-org guard a second
// time (the `invitation.orgId === input.orgId` check is sticky #30 —
// without it, an editor in org A passing org B's invitation id
// bypasses tenancy). Redundant on the happy path; deliberately
// kept as defence in depth.

import Elysia, { status, t } from "elysia";

import {
  InvitationError,
  revokeInvitation,
} from "../../../application/invitations";
import { protectedDeps } from "../_shared/deps";
import { authorizeOrgAccess, isAuthFailure } from "../_shared/orgAccess";
import { buildAuditContext } from "../_shared/auditContext";
import type { ProtectedAuthContext } from "../guards/authContextTypes";

export const deleteInvitationHandler = new Elysia().delete(
  "/orgs/:orgId/invitations/:id",
  async (ctx) => {
    const { params, headers, actor } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
    };

    const auth = await authorizeOrgAccess(
      { actor, paramOrgId: params.orgId },
      { membershipRepo: protectedDeps.membershipRepo },
    );
    if (isAuthFailure(auth)) {
      return auth;
    }

    const audit = buildAuditContext(headers);

    try {
      const invitation = await revokeInvitation(
        {
          invitationId: params.id,
          orgId: params.orgId,
          actorId: actor.localUserId,
          actorRole: auth.role,
          audit,
        },
        {
          workos: protectedDeps.workos,
          invitationRepo: protectedDeps.invitationRepo,
          auditRepo: protectedDeps.auditRepo,
        },
      );
      return invitation;
    } catch (err) {
      return translateRevokeError(err);
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      id: t.String({ format: "uuid" }),
    }),
  },
);

function translateRevokeError(err: unknown) {
  if (!(err instanceof InvitationError)) {
    throw err;
  }
  switch (err.reason) {
    case "actor_role_insufficient":
      return status(403, { ok: false as const, reason: err.reason });
    case "invitation_not_found":
      // Cross-org probes resolve here too — the application function
      // treats `invitation.orgId !== input.orgId` as not-found so the
      // response shape doesn't reveal the row's existence in another
      // org. 404 is the right code; the failure-audit row records
      // the actual owning org for forensics.
      return status(404, { ok: false as const, reason: err.reason });
    case "invitation_not_pending":
      return status(409, { ok: false as const, reason: err.reason });
    case "invitation_state_race":
      // A concurrent `acceptInvitation` won the race between our
      // pre-check and the conditional update. From the actor's
      // perspective the invitation is no longer pending — same
      // semantic as `invitation_not_pending`.
      return status(409, { ok: false as const, reason: err.reason });
    default:
      throw err;
  }
}
