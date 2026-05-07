// GET /orgs/:orgId/invitations — list invitations for the org.
//
// Slice 1 / T-014b. Wraps `listInvitations` from the application
// layer. Read-only — no audit emission. Default state filter is
// `pending` (the admin UI's primary view); override via
// `?state=accepted | revoked | expired`.
//
// Authorization mirrors POST/DELETE: cross-org guard + owner-or-
// admin role.

import Elysia, { t } from "elysia";

import { listInvitations } from "../../../application/invitations";
import { protectedDeps } from "../_shared/deps";
import { authorizeOrgAccess, isAuthFailure } from "../_shared/orgAccess";
import type { ProtectedAuthContext } from "../guards/authContextTypes";

export const getInvitationsHandler = new Elysia().get(
  "/orgs/:orgId/invitations",
  async (ctx) => {
    const { params, query, actor } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
    };

    const auth = await authorizeOrgAccess(
      { actor, paramOrgId: params.orgId },
      { membershipRepo: protectedDeps.membershipRepo },
    );
    if (isAuthFailure(auth)) {
      return auth;
    }

    return listInvitations(
      { orgId: params.orgId, state: query.state ?? "pending" },
      { invitationRepo: protectedDeps.invitationRepo },
    );
  },
  {
    params: t.Object({ orgId: t.String({ format: "uuid" }) }),
    query: t.Object({
      state: t.Optional(
        t.Union([
          t.Literal("pending"),
          t.Literal("accepted"),
          t.Literal("revoked"),
          t.Literal("expired"),
        ]),
      ),
    }),
  },
);
