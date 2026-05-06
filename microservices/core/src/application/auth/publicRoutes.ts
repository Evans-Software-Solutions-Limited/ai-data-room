// Public auth route bundle — Slice 1 / T-014a.
//
// All four routes here are unauthenticated by design — they're
// the ingress / egress for the AuthKit OAuth flow itself, so
// requiring a session would be circular. Wired into the core API
// at `microservices/core/src/api.ts` via `.use(publicRoutes)`.
//
// Future T-014b / T-015 work introduces protected routes; those
// land in a separate `protectedRoutes.ts` bundle behind a
// `requireAuth` resolve guard, mirroring FDP.

import Elysia from "elysia";

import { getCallbackHandler } from "./callback/getCallbackHandler";
import { getSignInHandler } from "./sign-in/getSignInHandler";
import { getSignOutHandler } from "./sign-out/getSignOutHandler";
import { getSignUpHandler } from "./sign-up/getSignUpHandler";

export const publicRoutes = new Elysia()
  .use(getSignInHandler)
  .use(getSignUpHandler)
  .use(getCallbackHandler)
  .use(getSignOutHandler);
