// GET /auth/sign-up — sibling of sign-in that lands on AuthKit's
// sign-up form. Two distinct routes (per design.md §Interfaces) so
// the web shell can link to the right initial form; AuthKit lets
// users toggle between sign-in / sign-up once they're on the
// hosted UI either way.

import { createAuthRedirectHandler } from "../_shared/createAuthRedirectHandler";

export const getSignUpHandler = createAuthRedirectHandler({
  path: "/auth/sign-up",
  screenHint: "sign-up",
  unavailableMessage: "Sign-up unavailable",
});
