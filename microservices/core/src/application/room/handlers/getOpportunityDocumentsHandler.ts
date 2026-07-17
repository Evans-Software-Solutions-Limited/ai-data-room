// GET /orgs/:orgId/opportunities/:id/documents — an Opportunity
// subroom's contents (FR7).
//
// room-and-folders (slice 2) / T-011. Wraps `listFolderContents`
// from the application layer with `target.kind === "opportunity"`.
// `listFolderContents` audits every folder listing (FR19). Viewers
// may read (`ROOM_READ_ROLES`).

import Elysia, { t } from "elysia";

import { listFolderContents } from "../listing";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { protectedDeps } from "../../auth/_shared/deps";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateListingError } from "./listingErrors";
import { ROOM_READ_ROLES } from "./roomDeps";

export const getOpportunityDocumentsHandler = new Elysia().get(
  "/orgs/:orgId/opportunities/:id/documents",
  async (ctx) => {
    const { params, headers, actor, scoped } = ctx as typeof ctx & {
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

    const audit = buildAuditContext(headers);

    try {
      return await listFolderContents(
        {
          target: { kind: "opportunity", opportunityId: params.id },
          actorUserId: actor.localUserId,
          audit,
        },
        {
          documents: scoped.documents,
          opportunities: scoped.opportunities,
          auditRepo: protectedDeps.auditRepo,
        },
      );
    } catch (err) {
      return translateListingError(err);
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      id: t.String({ format: "uuid" }),
    }),
  },
);
