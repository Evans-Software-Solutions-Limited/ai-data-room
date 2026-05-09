// POST /orgs/:orgId/users/:userId/unsuspend — restore a suspended
// user. Reverse of `postSuspendHandler`.
//
// Slice 1 / T-014b. Wraps `unsuspendUser`. WorkOS sessions don't
// need to be touched on this path — suspension already revoked
// them, and the user has to re-authenticate to mint fresh sessions.

import Elysia, { status, t } from "elysia";

import {
  SuspensionError,
  unsuspendUser,
} from "../../../application/suspension";
import { protectedDeps } from "../_shared/deps";
import { authorizeOrgAccess, isAuthFailure } from "../_shared/orgAccess";
import { buildAuditContext } from "../_shared/auditContext";
import type { ProtectedAuthContext } from "../guards/authContextTypes";

export const postUnsuspendHandler = new Elysia().post(
  "/orgs/:orgId/users/:userId/unsuspend",
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
      const user = await unsuspendUser(
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
      if (err instanceof SuspensionError && err.reason === "user_not_found") {
        return status(404, { ok: false as const, reason: err.reason });
      }
      throw err;
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      userId: t.String({ format: "uuid" }),
    }),
  },
);
