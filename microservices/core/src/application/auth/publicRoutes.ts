// Public auth route bundle.
//
// All four routes are unauthenticated by design — they're the
// ingress / egress for the AuthKit OAuth flow, so requiring a
// session would be circular. The `rateLimit` plugin (NFR4) gates
// the bundle on a per-IP counter; the in-memory store's limits
// are documented in `middleware/rateLimit.ts`.

import Elysia from "elysia";

import { LOGIN_RATE_LIMIT, rateLimit } from "../../middleware/rateLimit";
import { getCallbackHandler } from "./callback/getCallbackHandler";
import { getSignInHandler } from "./sign-in/getSignInHandler";
import { getSignOutHandler } from "./sign-out/getSignOutHandler";
import { getSignUpHandler } from "./sign-up/getSignUpHandler";

export const publicRoutes = new Elysia()
  .use(rateLimit(LOGIN_RATE_LIMIT))
  .use(getSignInHandler)
  .use(getSignUpHandler)
  .use(getCallbackHandler)
  .use(getSignOutHandler);
