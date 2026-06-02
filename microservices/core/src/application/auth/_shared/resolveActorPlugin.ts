// Shared `resolveActor` Elysia `.resolve()` adapter.
//
// Extracted from `protectedRoutes.ts` so both the protected bundle and
// the top-level `orgRoutes` bundle (org-provisioning, slice 17) wire the
// same actor-resolution step without duplicating the cast. Elysia's
// `.resolve()` expects `Record<string, unknown>`; the narrower
// `ActorContext` is structurally a record but TS won't widen
// automatically — `as unknown as` is the standard FDP workaround.

import { resolveActor } from "../guards/resolveActor";
import { protectedDeps } from "./deps";

export const resolveActorPlugin = async ({
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
      membershipRepo: protectedDeps.membershipRepo,
    },
  )) as unknown as Record<string, unknown>;
