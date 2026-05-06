// requireOrg — Elysia `.onBeforeHandle()` guard that gates
// org-scoped routes on a non-null `actor.localOrgId`. Mirrors FDP's
// `application/auth/guards/requireOrg.ts`.
//
// Slice 1 / T-015 + T-014b. Mounted under the `orgScopedRoutes`
// sub-bundle inside `protectedRoutes.ts` — `/me` deliberately opts
// out of this gate because it's the canonical endpoint for an
// unprovisioned user (post-organic-signup, pre-onboarding) to learn
// they have no org yet.
//
// 403 (not 401) because the request IS authenticated — the user
// just hasn't been provisioned into an org. 401 would imply
// "sign in" as the recovery path, which is wrong: signing in
// again puts them right back here.

import { status } from "elysia";

import type { ActorContext } from "./authContextTypes";

export function requireOrg({ actor }: Pick<ActorContext, "actor">) {
  if (!actor.localOrgId) {
    return status(403, {
      ok: false as const,
      reason: "no_org_membership" as const,
    });
  }
  return undefined;
}
