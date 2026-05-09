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
// Shared deps live in `_shared/deps.ts` (module scope; per FDP
// convention + sticky #41 warm-Lambda reuse). The handlers also
// read from the same module so per-request construction is gone.

import Elysia from "elysia";

import { getAuditEventsHandler } from "./audit-events/getAuditEventsHandler";
import { requireAuth } from "./guards/requireAuth";
import { requireOrg } from "./guards/requireOrg";
import { resolveActor } from "./guards/resolveActor";
import { deleteInvitationHandler } from "./invitations/deleteInvitationHandler";
import { getInvitationsHandler } from "./invitations/getInvitationsHandler";
import { postInvitationsHandler } from "./invitations/postInvitationsHandler";
import { protectedDeps } from "./_shared/deps";
import { getUserHandler } from "./user/getUserHandler";
import { postSuspendHandler } from "./users/postSuspendHandler";
import { postUnsuspendHandler } from "./users/postUnsuspendHandler";

// Elysia's `.resolve()` expects `Record<string, unknown>`; the
// narrower `ActorContext` shape is structurally a record but TS
// won't widen automatically — `as unknown as` is the standard
// workaround in the FDP pattern.
const resolveActorPlugin = async ({
  user,
  organizationId,
}: {
  user: Parameters<typeof resolveActor>[0]["user"];
  organizationId: Parameters<typeof resolveActor>[0]["organizationId"];
}) =>
  (await resolveActor(
    { user, organizationId },
    {
      userRepo: protectedDeps.userRepo,
      orgRepo: protectedDeps.orgRepo,
    },
  )) as unknown as Record<string, unknown>;

const meRoutes = new Elysia()
  .resolve(requireAuth)
  .resolve(resolveActorPlugin)
  .use(getUserHandler);

const orgScopedRoutes = new Elysia()
  .resolve(requireAuth)
  .resolve(resolveActorPlugin)
  .onBeforeHandle(requireOrg)
  .use(postInvitationsHandler)
  .use(getInvitationsHandler)
  .use(deleteInvitationHandler)
  .use(postSuspendHandler)
  .use(postUnsuspendHandler)
  .use(getAuditEventsHandler);

export const protectedRoutes = new Elysia().use(meRoutes).use(orgScopedRoutes);
