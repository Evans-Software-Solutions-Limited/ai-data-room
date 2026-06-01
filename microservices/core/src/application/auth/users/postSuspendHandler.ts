// POST /orgs/:orgId/users/:userId/suspend — suspend a user per FR21.
//
// Slice 1 / T-014b. Wraps `suspendUser` from the application layer.
// Authorization: cross-org guard + owner-or-editor role.
//
// Domain invariants enforced by the application function (sticky
// #22): no self-suspension, sole-owner cannot be suspended. The
// application function revokes WorkOS sessions BEFORE flipping our
// local lifecycle (sticky #19 — order is load-bearing).

import Elysia, { status, t } from "elysia";

import { SuspensionError, suspendUser } from "../../../application/suspension";
import { protectedDeps } from "../_shared/deps";
import { authorizeOrgAccess, isAuthFailure } from "../_shared/orgAccess";
import { buildAuditContext } from "../_shared/auditContext";
import type { ProtectedAuthContext } from "../guards/authContextTypes";

export const postSuspendHandler = new Elysia().post(
  "/orgs/:orgId/users/:userId/suspend",
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
      const user = await suspendUser(
        {
          actorId: actor.localUserId,
          targetId: params.userId,
          orgId: params.orgId,
          audit,
        },
        {
          workos: protectedDeps.workos,
          userRepo: protectedDeps.userRepo,
          membershipRepo: protectedDeps.membershipRepo,
          auditRepo: protectedDeps.auditRepo,
        },
      );
      return user;
    } catch (err) {
      return translateSuspensionError(err);
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      userId: t.String({ format: "uuid" }),
    }),
  },
);

function translateSuspensionError(err: unknown) {
  if (!(err instanceof SuspensionError)) {
    throw err;
  }
  switch (err.reason) {
    case "self_suspension":
      // 409 — the action conflicts with the domain rule (FR23). 403
      // would imply "you're not allowed at all", which is wrong:
      // this actor IS allowed to suspend others, just not themselves.
      return status(409, { ok: false as const, reason: err.reason });
    case "sole_owner_protection":
      return status(409, { ok: false as const, reason: err.reason });
    case "user_not_found":
      return status(404, { ok: false as const, reason: err.reason });
    default:
      throw err;
  }
}
