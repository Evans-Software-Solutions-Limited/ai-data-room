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
//   2. Load the sealed session, authenticate it (so we have a local
//      user UUID to credit on the audit row), ask WorkOS for the
//      AuthKit logout URL (which terminates the WorkOS-side
//      session), and emit the `logout` audit event.
//   3. Drop our local cookie and redirect to the AuthKit logout
//      URL, which redirects back to the frontend after WorkOS
//      finishes its side.
//
// Failures along the way (expired cookie, refresh failure,
// WorkOS unreachable) all collapse to "drop the cookie + redirect
// to the frontend" — better to UX-degrade than to wedge the user
// in a bad state. Audit emission is best-effort via `safeAudit`
// (the `auth.audit.write_failure` metric covers the dropped case).
//
// Deliberate departure from the protected-handler `protectedDeps`
// pattern: the audit deps are constructed at request time inside
// this handler rather than imported from `_shared/deps.ts`. That
// keeps the module-scope WorkOS construction (in `_shared/workosClient`)
// out of the public-route load graph — sticky #31's "per-request
// construction" contract for callback / sign-in / sign-out is
// preserved, and the public-route test surface stays narrow.

import Elysia from "elysia";
import { Resource } from "sst";

import { getDb } from "@ai-data-room/db";

import { AuditRepo } from "../../../infrastructure/db/auditRepo";
import { UserRepo } from "../../../infrastructure/db/userRepo";
import { createWorkOSClient } from "../../../infrastructure/workos/client";
import { safeAudit } from "../../_audit-context";
import { getPostAuthRedirectUrl } from "../config/frontendUrl";

export const getSignOutHandler = new Elysia().get(
  "/auth/sign-out",
  async ({ cookie, redirect, request }) => {
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

      // Authenticate first so we have a workos user id to resolve
      // to a local UUID for the audit row. If authenticate returns
      // `{ authenticated: false }` (expired access token but cookie
      // still decodes) we skip the audit emission rather than fan
      // out to a refresh — sign-out is best-effort and an expired
      // session is exactly the case where AC-US8's "audit event
      // records the logout" is least informative.
      const authResult = await session.authenticate();
      const logoutUrl = await session.getLogoutUrl({ returnTo });

      if (authResult.authenticated) {
        const db = getDb(Resource.PLANETSCALE_DATABASE_URL.value);
        const userRepo = new UserRepo(db);
        const auditRepo = new AuditRepo(db);
        const localUser = await userRepo.findByWorkosUserId(authResult.user.id);
        if (localUser) {
          await safeAudit(
            { auditRepo },
            {
              eventType: "logout",
              outcome: "success",
              actorUserId: localUser.id,
              targetUserId: localUser.id,
              sourceIp:
                request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
                "unknown",
              userAgent: request.headers.get("user-agent") ?? "unknown",
              metadata: { workosUserId: authResult.user.id },
            },
          );
        }
      }

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
