// Type definitions for the resolved auth context — the shape that
// `requireAuth` writes into Elysia's request context, plus the
// post-`resolveActor` shape that handlers actually consume.
//
// Slice 1 / T-015. The two-step shape (auth-only → auth+actor) lets
// the protected-routes bundle compose them in the right order:
//
//   .resolve(requireAuth)     // adds AuthContext (WorkOS-side identity)
//   .resolve(resolveActor)    // adds ActorContext (local-DB identity)
//
// `/me` opts out of `requireOrg`, so its handler only reads the
// `actor.localUserId` half of `ActorContext` — `localOrgId` may be
// `null` for a freshly-signed-up user not yet provisioned into an org.
// Org-scoped handlers go through the `requireOrg` gate that asserts
// `localOrgId !== null` before they run.

import type { User as WorkOSUser } from "../../../infrastructure/workos/client";

/**
 * The identity surface produced by `requireAuth` from a valid sealed
 * session cookie. `user` and `organizationId` are WorkOS-side values
 * — `user.id` is `user_…` (not our local `users.id` UUID), and
 * `organizationId` is `org_…` (not our local `organizations.id` UUID).
 *
 * `organizationId` is `string | null | undefined` because:
 *   - A pure-external user (no membership row in WorkOS) has `null`.
 *   - The SDK's older session payloads predate the field and may
 *     return `undefined`. We treat both as "no org" for routing.
 */
export interface AuthContext {
  user: WorkOSUser;
  organizationId: string | null | undefined;
}

/**
 * The actor surface produced by `resolveActor` from an `AuthContext`
 * — WorkOS-side IDs translated to our local UUIDs via the existing
 * `userRepo.findByWorkosUserId` and `orgRepo.findByWorkosOrgId`
 * lookups. `localUserId` is created lazily on first request for a
 * fresh organic signup; `localOrgId` stays `null` until org
 * provisioning lands in slice 9 (`onboarding-flow`).
 *
 * Application functions (`createInvitation`, `suspendUser`, etc.)
 * take local UUIDs in their `Input` shapes — the handler layer
 * passes `actor.localUserId` / `actor.localOrgId` straight through.
 */
export interface ActorContext {
  actor: {
    localUserId: string;
    localOrgId: string | null;
  };
}

/**
 * The shape every protected handler can rely on once `requireAuth`
 * and `resolveActor` have run. `/me` reads from this with
 * `localOrgId` possibly `null`; org-scoped handlers run after
 * `requireOrg` has narrowed `localOrgId` to a non-null string but
 * the type stays optimistic — handlers re-validate at the
 * `params.orgId === localOrgId` cross-org check (sticky #30).
 */
export type ProtectedAuthContext = AuthContext & ActorContext;
