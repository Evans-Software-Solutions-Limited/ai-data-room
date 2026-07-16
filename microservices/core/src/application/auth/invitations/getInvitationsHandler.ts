// GET /orgs/:orgId/invitations — list invitations for the org.
//
// Slice 1 / T-014b. Wraps `listInvitations` from the application
// layer. Read-only — no audit emission. Default state filter is
// `pending` (the admin UI's primary view); override via
// `?state=accepted | revoked | expired`.
//
// Authorization mirrors POST/DELETE: cross-org guard + owner-or-
// editor role.

import Elysia, { t } from "elysia";

import { listInvitations } from "../../../application/invitations";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { authorizeOrgAccess, isAuthFailure } from "../_shared/orgAccess";
import type { ProtectedAuthContext } from "../guards/authContextTypes";

export const getInvitationsHandler = new Elysia().get(
  "/orgs/:orgId/invitations",
  async (ctx) => {
    const { params, query, actor, scoped } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
      scoped: ScopedRepos;
    };

    const auth = await authorizeOrgAccess(
      { actor, paramOrgId: params.orgId },
      { membership: scoped.membership },
    );
    if (isAuthFailure(auth)) {
      return auth;
    }

    return listInvitations(
      { state: query.state ?? "pending" },
      { invitations: scoped.invitations },
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
