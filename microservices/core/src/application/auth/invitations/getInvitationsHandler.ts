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
import { Resource } from "sst";

import { getDb } from "@ai-data-room/db";

import { listInvitations } from "../../../application/invitations";
import { InvitationRepo } from "../../../infrastructure/db/invitationRepo";
import { MembershipRepo } from "../../../infrastructure/db/membershipRepo";
import { authorizeOrgAccess, isAuthFailure } from "../_shared/orgAccess";
import type { ProtectedAuthContext } from "../guards/authContextTypes";

export const getInvitationsHandler = new Elysia().get(
  "/orgs/:orgId/invitations",
  async (ctx) => {
    const { params, query, actor } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
    };
    const db = getDb(Resource.PLANETSCALE_DATABASE_URL.value);
    const invitationRepo = new InvitationRepo(db);
    const membershipRepo = new MembershipRepo(db);

    const auth = await authorizeOrgAccess(
      { actor, paramOrgId: params.orgId },
      { membershipRepo },
    );
    if (isAuthFailure(auth)) {
      return auth;
    }

    return listInvitations(
      { orgId: params.orgId, state: query.state ?? "pending" },
      { invitationRepo },
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
