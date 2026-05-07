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
// Module-scope deps: per FDP convention (and sticky #41 Lambda
// warm-start cache reuse), the database client and the repos shared
// across the two `.resolve(resolveActor)` chains are constructed
// once at module load. SST surfaces `Resource.*` before the Lambda
// runtime calls into our handler, so module-scope reads are safe.

import Elysia from "elysia";
import { Resource } from "sst";

import { getDb } from "@ai-data-room/db";

import { OrgRepo } from "../../infrastructure/db/orgRepo";
import { UserRepo } from "../../infrastructure/db/userRepo";

import { getAuditEventsHandler } from "./audit-events/getAuditEventsHandler";
import { requireAuth } from "./guards/requireAuth";
import { requireOrg } from "./guards/requireOrg";
import { resolveActor } from "./guards/resolveActor";
import { deleteInvitationHandler } from "./invitations/deleteInvitationHandler";
import { getInvitationsHandler } from "./invitations/getInvitationsHandler";
import { postInvitationsHandler } from "./invitations/postInvitationsHandler";
import { getUserHandler } from "./user/getUserHandler";
import { postSuspendHandler } from "./users/postSuspendHandler";
import { postUnsuspendHandler } from "./users/postUnsuspendHandler";

const db = getDb(Resource.PLANETSCALE_DATABASE_URL.value);
const userRepo = new UserRepo(db);
const orgRepo = new OrgRepo(db);

const meRoutes = new Elysia()
  .resolve(requireAuth)
  .resolve(
    async ({ user, organizationId }) =>
      // Elysia's `.resolve()` expects `Record<string, unknown>`; the
      // narrower `ActorContext` shape is structurally a record but
      // TS won't widen automatically — `as unknown as` is the
      // standard workaround in the FDP pattern.
      (await resolveActor(
        { user, organizationId },
        { userRepo, orgRepo },
      )) as unknown as Record<string, unknown>,
  )
  .use(getUserHandler);

const orgScopedRoutes = new Elysia()
  .resolve(requireAuth)
  .resolve(
    async ({ user, organizationId }) =>
      // Elysia's `.resolve()` expects `Record<string, unknown>`; the
      // narrower `ActorContext` shape is structurally a record but
      // TS won't widen automatically — `as unknown as` is the
      // standard workaround in the FDP pattern.
      (await resolveActor(
        { user, organizationId },
        { userRepo, orgRepo },
      )) as unknown as Record<string, unknown>,
  )
  .onBeforeHandle(requireOrg)
  .use(postInvitationsHandler)
  .use(getInvitationsHandler)
  .use(deleteInvitationHandler)
  .use(postSuspendHandler)
  .use(postUnsuspendHandler)
  .use(getAuditEventsHandler);

export const protectedRoutes = new Elysia().use(meRoutes).use(orgScopedRoutes);
