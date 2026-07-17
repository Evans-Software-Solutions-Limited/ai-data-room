// POST /orgs/:orgId/opportunities — create an Opportunity subroom
// (FR4).
//
// room-and-folders (slice 2) / T-011. Wraps `createOpportunity` from
// the application layer. Authorization: cross-org guard +
// owner-or-editor role (mutation — default `authorizeOrgAccess`
// allowlist).

import Elysia, { t } from "elysia";

import { createOpportunity } from "../opportunities";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { protectedDeps } from "../../auth/_shared/deps";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateOpportunityError } from "./opportunityErrors";

export const postOpportunityHandler = new Elysia().post(
  "/orgs/:orgId/opportunities",
  async (ctx) => {
    const { params, body, headers, actor, scoped, set } = ctx as typeof ctx & {
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
      const opportunity = await createOpportunity(
        {
          slug: body.slug,
          name: body.name,
          actorUserId: actor.localUserId,
          audit,
        },
        {
          db: protectedDeps.db,
          opportunities: scoped.opportunities,
          auditRepo: protectedDeps.auditRepo,
        },
      );
      set.status = 201;
      return opportunity;
    } catch (err) {
      return translateOpportunityError(err);
    }
  },
  {
    params: t.Object({ orgId: t.String({ format: "uuid" }) }),
    body: t.Object({
      slug: t.String({ minLength: 1, maxLength: 64 }),
      name: t.Optional(t.String({ minLength: 1 })),
    }),
  },
);
