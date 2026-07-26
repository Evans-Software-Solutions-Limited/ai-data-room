// PATCH /orgs/:orgId/opportunities/:id — rename an Opportunity
// subroom (FR5).
//
// room-and-folders (slice 2) / T-011. Wraps `renameOpportunity` from
// the application layer. Authorization: cross-org guard +
// owner-or-editor role (mutation — default `authorizeOrgAccess`
// allowlist).

import Elysia, { t } from "elysia";

import { renameOpportunity } from "../opportunities";
import { toOpportunityDTO } from "../dto";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { protectedDeps } from "../../auth/_shared/deps";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateOpportunityError } from "./opportunityErrors";

export const patchOpportunityHandler = new Elysia().patch(
  "/orgs/:orgId/opportunities/:id",
  async (ctx) => {
    const { params, body, headers, actor, scoped } = ctx as typeof ctx & {
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
      const opportunity = await renameOpportunity(
        {
          id: params.id,
          slug: body.slug,
          name: body.name,
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
      // Client DTO (see `postOpportunityHandler` for why).
      return toOpportunityDTO(opportunity);
    } catch (err) {
      return translateOpportunityError(err);
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      id: t.String({ format: "uuid" }),
    }),
    body: t.Object({
      slug: t.String({ minLength: 1, maxLength: 64 }),
      name: t.Optional(t.String({ minLength: 1 })),
    }),
  },
);
