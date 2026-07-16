// Protected route bundle — Slice 1 / T-015 + T-014b.
//
// Wires the three guards (`requireAuth`, `resolveActor`, `requireOrg`)
// in front of the seven protected handlers.
//
// **Two sub-bundles** — driven by `/me`'s need to opt out of the
// org gate so a freshly-signed-up user without an org can still
// reach the endpoint that tells them so:
//
//   - `meRoutes`: `requireAuth` + `resolveActor` only. Mounts
//     `getUserHandler` (`GET /me`).
//   - `orgScopedRoutes`: `requireAuth` + `resolveActor` +
//     `requireOrg`. Mounts the six `/orgs/:orgId/*` handlers.
//
// Each Elysia instance gets its own guard chain because Elysia's
// `.onBeforeHandle()` applies to every route in the same instance —
// using a single bundle and then a `.guard()` callback would either
// run requireOrg on /me or require some param-key trick. Two
// instances is clearer and matches FDP's separation pattern.
//
// `POST /orgs` (org-provisioning, slice 17) is NOT here — it lives in
// its own top-level `orgRoutes` bundle (`application/orgs/orgRoutes.ts`)
// and rate-limits via a route-local `.onBeforeHandle`. The reliable
// scope for a limiter is `.onBeforeHandle` (instance-local, the same
// scoping `requireOrg` relies on), NOT a separate top-level app: an
// `onRequest` limiter from a named plugin propagates across the whole
// composed app regardless of which bundle it's attached to — that's
// how `publicRoutes`' login cap once leaked onto `/me` (now fixed by
// switching it to `.onBeforeHandle` too). Both regressions are pinned
// by the route tests.
//
// Shared deps live in `_shared/deps.ts` (module scope; per FDP
// convention + sticky #41 warm-Lambda reuse). The handlers also
// read from the same module so per-request construction is gone.

import Elysia from "elysia";

import { getAuditEventsHandler } from "./audit-events/getAuditEventsHandler";
import { requireAuth } from "./guards/requireAuth";
import { requireOrg } from "./guards/requireOrg";
import { createScopedReposGuard } from "./guards/resolveScopedRepos";
import { resolveTenantContext } from "./guards/resolveTenantContext";
import { protectedDeps } from "./_shared/deps";
import { resolveActorPlugin } from "./_shared/resolveActorPlugin";
import { deleteInvitationHandler } from "./invitations/deleteInvitationHandler";
import { getInvitationsHandler } from "./invitations/getInvitationsHandler";
import { postInvitationsHandler } from "./invitations/postInvitationsHandler";
import { getUserHandler } from "./user/getUserHandler";
import { postSuspendHandler } from "./users/postSuspendHandler";
import { postUnsuspendHandler } from "./users/postUnsuspendHandler";

const meRoutes = new Elysia()
  .resolve(requireAuth)
  .resolve(resolveActorPlugin)
  .use(getUserHandler);

const orgScopedRoutes = new Elysia()
  .resolve(requireAuth)
  .resolve(resolveActorPlugin)
  .onBeforeHandle(requireOrg)
  // FR1: after `requireOrg` has asserted a non-null `localOrgId`, lift it into
  // a request-scoped `TenantContext` that later-slice handlers pass to
  // `scopedRepo`. Runs after the gate so the org is guaranteed present.
  .resolve(resolveTenantContext)
  // T-004 (FR3): build the request's tenant-scoped repo bundle right after
  // the tenant context is established, so every handler below reads
  // `ctx.scoped.<repo>` instead of constructing its own unscoped repo.
  .resolve(createScopedReposGuard(protectedDeps.db))
  .use(postInvitationsHandler)
  .use(getInvitationsHandler)
  .use(deleteInvitationHandler)
  .use(postSuspendHandler)
  .use(postUnsuspendHandler)
  .use(getAuditEventsHandler);

export const protectedRoutes = new Elysia().use(meRoutes).use(orgScopedRoutes);
