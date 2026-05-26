// Public auth route bundle.
//
// All routes here are unauthenticated by design — they're the
// ingress / egress for the AuthKit OAuth flow, so requiring a
// session would be circular. The `rateLimit` plugin (NFR4) gates
// the bundle on a per-IP counter; the in-memory store's limits
// are documented in `middleware/rateLimit.ts`.
//
// `postE2EAuthLoginHandler` is conditionally mounted — present in
// non-prod stages, absent in production. The conditional mount is
// the primary defence (the route literally doesn't exist in prod,
// so Elysia's schema validator can't 422 a malformed request and
// fingerprint the endpoint's existence). The handler also self-gates
// with `isProduction → 404` as belt-and-braces.

import Elysia from "elysia";

import { LOGIN_RATE_LIMIT, rateLimit } from "../../middleware/rateLimit";
import { getCallbackHandler } from "./callback/getCallbackHandler";
import { isProduction } from "./config/frontendUrl";
import { postE2EAuthLoginHandler } from "./e2e-bootstrap/postE2EAuthLoginHandler";
import { getSignInHandler } from "./sign-in/getSignInHandler";
import { getSignOutHandler } from "./sign-out/getSignOutHandler";
import { getSignUpHandler } from "./sign-up/getSignUpHandler";

const baseRoutes = new Elysia()
  .use(rateLimit(LOGIN_RATE_LIMIT))
  .use(getSignInHandler)
  .use(getSignUpHandler)
  .use(getCallbackHandler)
  .use(getSignOutHandler);

export const publicRoutes = isProduction
  ? baseRoutes
  : baseRoutes.use(postE2EAuthLoginHandler);
