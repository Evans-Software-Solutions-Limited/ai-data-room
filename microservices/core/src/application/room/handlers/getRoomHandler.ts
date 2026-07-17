// GET /orgs/:orgId/rooms — the room overview (FR7): the seven
// canonical folders plus the org's live Opportunity subrooms.
//
// room-and-folders (slice 2) / T-011. Wraps `getRoom` from the
// application layer. Read-only — no audit emission (matches
// `getRoom`'s own doc comment). Viewers may read (`ROOM_READ_ROLES`).

import Elysia, { t } from "elysia";

import { getRoom } from "../listing";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { ROOM_READ_ROLES } from "./roomDeps";

export const getRoomHandler = new Elysia().get(
  "/orgs/:orgId/rooms",
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

    return getRoom({ opportunities: scoped.opportunities });
  },
  {
    params: t.Object({ orgId: t.String({ format: "uuid" }) }),
  },
);
