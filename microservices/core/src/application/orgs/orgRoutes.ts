// Org-provisioning route bundle — slice 17 / T-003.
//
// Its own bundle (mounted into the API app in `api.ts`). The create-org
// rate limiter is applied as a route-local `.onBeforeHandle` rather than
// the `onRequest` `rateLimit` plugin: `onRequest` from a named plugin
// propagates across the whole composed app and would throttle `/me`,
// whereas `onBeforeHandle` stays scoped to this instance (the same
// scoping `requireOrg` relies on to not run on `/me`). The route tests
// pin that `/me` is never throttled by this limiter.
//
// Guards: `requireAuth` + `resolveActor` only — NOT `requireOrg`, since
// the caller has no org context at creation time (sticky #36, same
// reason `/me` lives in `meRoutes`).

import Elysia from "elysia";

import {
  ORG_CREATE_RATE_LIMIT,
  rateLimitBeforeHandle,
} from "../../middleware/rateLimit";
import { requireAuth } from "../auth/guards/requireAuth";
import { resolveActorPlugin } from "../auth/_shared/resolveActorPlugin";
import { postOrgsHandler } from "./create/postOrgsHandler";

export const orgRoutes = new Elysia()
  .resolve(requireAuth)
  .resolve(resolveActorPlugin)
  .onBeforeHandle(rateLimitBeforeHandle(ORG_CREATE_RATE_LIMIT))
  .use(postOrgsHandler);
