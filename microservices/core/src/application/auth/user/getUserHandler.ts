// GET /me — current-user endpoint per FR14.
//
// Slice 1 / T-015 + T-014b. Mounted on the `meRoutes` sub-bundle
// inside `protectedRoutes.ts` — opts out of `requireOrg` so a
// freshly-signed-up user without an org can still hit it (and learn
// from the response that they need to onboard into one). Sticky #45 +
// the design-doc amendment land that shape: `role` and `orgId` are
// jointly nullable for the unprovisioned case.
//
// What the handler does:
//
//   1. Read `actor.localUserId` and `actor.localOrgId` from the
//      `requireAuth + resolveActor` context.
//   2. Load the local `users` row by id. Should always exist (the
//      lazy-mirror in `resolveActor` guarantees it), but a 500 fires
//      defensively if it doesn't — we don't want to fabricate a
//      partial /me shape from session-only data.
//   3. If `localOrgId` is set, load the org + the actor's
//      membership. Skipped for unprovisioned users so we don't
//      conjure an org row just to populate a null.
//   4. Load active external-access grants — populates
//      `opportunityScopes[]` per the FR14 shape.
//   5. Return the documented response.
//
// Deliberately NOT using a Zod / Elysia schema for the response —
// the response shape comes from the `MeResponse` type alias and
// stays in sync with the spec via the `t.Object` declaration on the
// route. A future schema-driven refactor (alongside the OpenAPI
// generation) can centralise this.

import Elysia, { status, t } from "elysia";

import { protectedDeps } from "../_shared/deps";
import type { ProtectedAuthContext } from "../guards/authContextTypes";

const meResponseSchema = t.Object({
  userId: t.String(),
  email: t.Union([t.String(), t.Null()]),
  fullName: t.Union([t.String(), t.Null()]),
  role: t.Union([
    t.Literal("owner"),
    t.Literal("editor"),
    t.Literal("viewer"),
    t.Literal("external"),
    t.Null(),
  ]),
  orgId: t.Union([t.String(), t.Null()]),
  orgName: t.Union([t.String(), t.Null()]),
  opportunityScopes: t.Array(t.String()),
  emailVerified: t.Boolean(),
  mfaEnrolled: t.Boolean(),
  lifecycleState: t.Union([
    t.Literal("active"),
    t.Literal("suspended"),
    t.Literal("deleted"),
  ]),
});

export const getUserHandler = new Elysia().get(
  "/me",
  async (ctx) => {
    // Elysia plugins compose by handler — the standalone instance
    // doesn't see the parent bundle's `.resolve(resolveActor)`
    // augmentations at type level, so we narrow inside the body.
    // Same pattern as FDP's `getUserHandler`.
    const { actor } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
    };

    const user = await protectedDeps.userRepo.findById(actor.localUserId);
    if (!user) {
      // Should never fire — `resolveActor` lazy-creates the row
      // before this handler runs. If it does fire, the user mirror
      // was deleted between guard and handler (unlikely race) or
      // there's a real bug. 500 surfaces the inconsistency rather
      // than fabricating a /me shape from session-only data.
      return status(500, {
        ok: false as const,
        reason: "user_mirror_missing" as const,
      });
    }

    let role: "owner" | "editor" | "viewer" | "external" | null = null;
    let orgName: string | null = null;
    if (actor.localOrgId) {
      const [org, membership] = await Promise.all([
        protectedDeps.orgRepo.findById(actor.localOrgId),
        protectedDeps.membershipRepo.findByOrgUser(
          actor.localOrgId,
          actor.localUserId,
        ),
      ]);
      orgName = org?.name ?? null;
      role = membership?.role ?? null;
    }

    // External users don't have a membership row; their role is
    // signalled by the presence of grants under this user. Slice 3
    // will tighten this once it lands the access-check flow; for now
    // "has any active grant" is a good-enough proxy for `external`.
    const grants = await protectedDeps.externalGrantRepo.listByUser(
      actor.localUserId,
    );
    const activeGrants = grants.filter((g) => g.status === "active");
    const opportunityScopes = activeGrants.map((g) => g.opportunitySlug);
    if (role === null && activeGrants.length > 0) {
      role = "external";
    }

    return {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role,
      orgId: actor.localOrgId,
      orgName,
      opportunityScopes,
      emailVerified: user.emailVerifiedAt !== null,
      mfaEnrolled: user.mfaEnrolledAt !== null,
      lifecycleState: user.lifecycleState,
    };
  },
  {
    response: {
      200: meResponseSchema,
      500: t.Object({
        ok: t.Literal(false),
        reason: t.Literal("user_mirror_missing"),
      }),
    },
  },
);
