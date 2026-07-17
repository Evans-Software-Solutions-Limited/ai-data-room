// POST /orgs/:orgId/opportunities/:id/archive — archive an
// Opportunity subroom (FR6), revoking its active external grants
// (ADR-014).
//
// room-and-folders (slice 2) / T-011. Wraps `archiveOpportunity`
// from the application layer. Authorization: cross-org guard +
// owner-or-editor role (mutation — default `authorizeOrgAccess`
// allowlist).

import Elysia, { t } from "elysia";

import { archiveOpportunity } from "../opportunities";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { protectedDeps } from "../../auth/_shared/deps";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateOpportunityError } from "./opportunityErrors";

export const postArchiveOpportunityHandler = new Elysia().post(
  "/orgs/:orgId/opportunities/:id/archive",
  async (ctx) => {
    const { params, headers, actor, scoped } = ctx as typeof ctx & {
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

    const audit = buildAuditContext(headers);

    try {
      return await archiveOpportunity(
        {
          id: params.id,
          actorUserId: actor.localUserId,
          audit,
        },
        {
          db: protectedDeps.db,
          opportunities: scoped.opportunities,
          externalGrants: scoped.externalGrants,
          auditRepo: protectedDeps.auditRepo,
        },
      );
    } catch (err) {
      return translateOpportunityError(err);
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      id: t.String({ format: "uuid" }),
    }),
  },
);
