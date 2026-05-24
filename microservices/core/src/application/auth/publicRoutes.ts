// Public auth route bundle.
//
// All routes here are unauthenticated by design — they're the
// ingress / egress for the AuthKit OAuth flow, so requiring a
// session would be circular. The `rateLimit` plugin (NFR4) gates
// the bundle on a per-IP counter; the in-memory store's limits
// are documented in `middleware/rateLimit.ts`.
//
// `postE2EAuthLoginHandler` mounts the `/e2e/auth/login` bootstrap
// for the Playwright suite. It self-gates (404 in production, 503
// without a configured `E2E_AUTH_SECRET`), so mounting unconditionally
// here is safe — the production stack never serves an authenticated
// response from that path.

import Elysia from "elysia";

import { LOGIN_RATE_LIMIT, rateLimit } from "../../middleware/rateLimit";
import { getCallbackHandler } from "./callback/getCallbackHandler";
import { postE2EAuthLoginHandler } from "./e2e-bootstrap/postE2EAuthLoginHandler";
import { getSignInHandler } from "./sign-in/getSignInHandler";
import { getSignOutHandler } from "./sign-out/getSignOutHandler";
import { getSignUpHandler } from "./sign-up/getSignUpHandler";

export const publicRoutes = new Elysia()
  .use(rateLimit(LOGIN_RATE_LIMIT))
  .use(getSignInHandler)
  .use(getSignUpHandler)
  .use(getCallbackHandler)
  .use(getSignOutHandler)
  .use(postE2EAuthLoginHandler);
