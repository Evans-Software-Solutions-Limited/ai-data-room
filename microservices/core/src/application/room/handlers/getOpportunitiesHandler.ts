// GET /orgs/:orgId/opportunities — list live Opportunity subrooms
// (FR7).
//
// room-and-folders (slice 2) / T-011. Wraps `listOpportunities` from
// the application layer. Read-only — no audit emission (matches
// `listOpportunities`'s own doc comment). Viewers may read
// (`ROOM_READ_ROLES`).

import Elysia, { t } from "elysia";

import { listOpportunities } from "../opportunities";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { ROOM_READ_ROLES } from "./roomDeps";

export const getOpportunitiesHandler = new Elysia().get(
  "/orgs/:orgId/opportunities",
  async (ctx) => {
    const { params, actor, scoped } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
      scoped: ScopedRepos;
    };

    const auth = await authorizeOrgAccess(
      { actor, paramOrgId: params.orgId },
      { membership: scoped.membership },
      ROOM_READ_ROLES,
    );
    if (isAuthFailure(auth)) {
      return auth;
    }

    return listOpportunities({ opportunities: scoped.opportunities });
  },
  {
    params: t.Object({ orgId: t.String({ format: "uuid" }) }),
  },
);
