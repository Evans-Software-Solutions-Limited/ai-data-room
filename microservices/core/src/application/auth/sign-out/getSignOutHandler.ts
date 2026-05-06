// GET /auth/sign-out — terminate the current sealed session.
//
// Slice 1 / T-014a. Mirrors FDP's pattern (a GET so the web shell
// can link to it without needing a form + CSRF token; cookie
// removal is idempotent and side-effect-only on the user's own
// session).
//
// Flow:
//   1. Read the `wos_session` cookie. Missing / non-string → just
//      clear and redirect (no-op for a not-signed-in user).
//   2. Load the sealed session, ask WorkOS for the AuthKit logout
//      URL (which terminates the WorkOS-side session).
//   3. Drop our local cookie and redirect to the AuthKit logout
//      URL, which redirects back to the frontend after WorkOS
//      finishes its side.
//
// Failures along the way (expired cookie, refresh failure,
// WorkOS unreachable) all collapse to "drop the cookie + redirect
// to the frontend" — better to UX-degrade than to wedge the user
// in a bad state.

import Elysia from "elysia";
import { Resource } from "sst";

import { createWorkOSClient } from "../../../infrastructure/workos/client";
import { getPostAuthRedirectUrl } from "../config/frontendUrl";

export const getSignOutHandler = new Elysia().get(
  "/auth/sign-out",
  async ({ cookie, redirect }) => {
    const sessionData = cookie.wos_session.value;
    const returnTo = getPostAuthRedirectUrl();

    // Elysia types `cookie.value` as `unknown` until consumed —
    // narrow with `typeof` rather than a cast so we also defend
    // against a future schema change that allows non-string
    // cookie values.
    if (typeof sessionData !== "string" || sessionData.length === 0) {
      return redirect(returnTo);
    }

    try {
      const workos = createWorkOSClient({
        apiKey: Resource.WORKOS_API_KEY.value,
        clientId: Resource.WORKOS_CLIENT_ID.value,
      });
      const session = workos.loadSealedSession({
        sessionData,
        cookiePassword: Resource.WORKOS_COOKIE_PASSWORD.value,
      });

      const logoutUrl = await session.getLogoutUrl({ returnTo });
      cookie.wos_session.remove();
      return redirect(logoutUrl);
    } catch {
      // Sealed-session decode failed (e.g. cookiePassword rotated
      // mid-session, malformed cookie). Best-effort: drop the
      // cookie locally so the user's next request is clean, then
      // bounce them to the frontend.
      cookie.wos_session.remove();
      return redirect(returnTo);
    }
  },
);
