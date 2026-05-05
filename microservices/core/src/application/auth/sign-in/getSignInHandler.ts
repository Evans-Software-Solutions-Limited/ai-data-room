// GET /auth/sign-in — OAuth flow entry point that lands on
// AuthKit's sign-in form. Body is in `_shared/createAuthRedirectHandler`;
// the callback at `/auth/callback` validates the state cookie set
// here before exchanging the returned code.

import { createAuthRedirectHandler } from "../_shared/createAuthRedirectHandler";

export const getSignInHandler = createAuthRedirectHandler({
  path: "/auth/sign-in",
  screenHint: "sign-in",
  unavailableMessage: "Sign-in unavailable",
});
