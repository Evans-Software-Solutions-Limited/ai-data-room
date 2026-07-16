// POST /orgs — create the caller's organisation (slice 17 / T-003).
//
// Mounted on a dedicated `orgProvisioningRoutes` sub-bundle in
// `protectedRoutes.ts` that runs `requireAuth` + `resolveActor` but NOT
// `requireOrg` — the caller has no org context at creation time (sticky
// #36, the same reason `/me` lives in `meRoutes`). It's its own bundle
// (not literally inside `meRoutes`) so the create-org rate limiter is
// scoped to this route alone and can't throttle `/me`, which the web
// shell polls on load.
//
// The handler is thin: validate the body, fast-reject a caller who
// already has an org, delegate to `createOrg`, and translate errors.
// All provisioning logic + the WorkOS/DB/audit/event orchestration
// lives in the application function.

import Elysia, { status, t } from "elysia";

import { CreateOrgInputSchema } from "@ai-data-room/api-utils/schemas/org";

import {
  createOrg,
  CreateOrgError,
  recordCreateOrgFailure,
} from "../createOrg";
import { protectedDeps } from "../../auth/_shared/deps";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";

export const postOrgsHandler = new Elysia().post(
  "/orgs",
  async (ctx) => {
    // Standalone Elysia plugins don't see the parent bundle's
    // `.resolve(resolveActor)` at type level — narrow inside the body
    // (sticky #37).
    const { body, headers, actor, set } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
    };

    const audit = buildAuditContext(headers);

    // FR5 fast path: a caller whose session already resolves to an org
    // can't create a second one. `createOrg` re-checks against the DB
    // (the authoritative guard + race backstop); this avoids minting a
    // WorkOS org just to roll it back. Record the same failure metric +
    // audit row as every other FR5 rejection — this is the common path,
    // and an attempted second-org is an auditable FR5 violation.
    if (actor.localOrgId !== null) {
      await recordCreateOrgFailure(
        { auditRepo: protectedDeps.auditRepo },
        actor.localUserId,
        audit,
        "already_in_org",
        actor.localOrgId,
      );
      return status(409, { ok: false as const, reason: "already_in_org" });
    }

    // Trim + 1–80 validation is owned by the zod schema (T-001); the
    // Elysia `body` schema below is only the coarse shape guard.
    const parsed = CreateOrgInputSchema.safeParse(body);
    if (!parsed.success) {
      return status(400, { ok: false as const, reason: "invalid_name" });
    }

    try {
      const result = await createOrg(
        { actorUserId: actor.localUserId, input: parsed.data, audit },
        {
          db: protectedDeps.db,
          workos: protectedDeps.workos,
          orgRepo: protectedDeps.orgRepo,
          bootstrap: protectedDeps.bootstrap,
          auditRepo: protectedDeps.auditRepo,
          events: protectedDeps.events,
        },
      );
      set.status = 201;
      return { orgId: result.orgId, role: result.role };
    } catch (err) {
      return translateCreateOrgError(err);
    }
  },
  {
    body: t.Object({ name: t.String() }),
    response: {
      201: t.Object({
        orgId: t.String(),
        role: t.Literal("owner"),
      }),
      400: t.Object({
        ok: t.Literal(false),
        reason: t.Literal("invalid_name"),
      }),
      409: t.Object({
        ok: t.Literal(false),
        reason: t.Union([
          t.Literal("already_in_org"),
          t.Literal("already_member"),
        ]),
      }),
      500: t.Object({
        ok: t.Literal(false),
        reason: t.Literal("provisioning_failed"),
      }),
    },
  },
);

function translateCreateOrgError(err: unknown) {
  if (!(err instanceof CreateOrgError)) {
    throw err;
  }
  switch (err.reason) {
    case "already_member":
      // Defence in depth — the `actor.localOrgId` fast path should have
      // caught this, but `createOrg` re-validates against the DB and we
      // honour its 409.
      return status(409, { ok: false as const, reason: "already_member" });
    case "provisioning_failed":
      return status(500, {
        ok: false as const,
        reason: "provisioning_failed",
      });
    default:
      throw err;
  }
}
