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
//   2. Load the sealed session. Try `authenticate()`; if the access
//      token has rolled over, fall through to `session.refresh()`
//      before deciding the user has no verified actor — mirrors the
//      ladder in `application/auth/guards/requireAuth.ts` so the
//      common refresh-needed sign-out (most real sign-outs land
//      here, since access tokens are minutes-short) still records
//      the AC-US8 audit row.
//   3. Ask WorkOS for the AuthKit logout URL (terminates the
//      WorkOS-side session) and emit the `logout` audit event.
//   4. Drop our local cookie and redirect to the AuthKit logout
//      URL, which redirects back to the frontend after WorkOS
//      finishes its side.
//
// Failures along the way (expired cookie, refresh failure,
// WorkOS unreachable) collapse to "drop the cookie + redirect to
// the frontend" — better to UX-degrade than to wedge the user in
// a bad state. **DB failures in the audit-resolution block are
// isolated in their own inner try/catch** so a PlanetScale outage
// can't downgrade sign-out from "terminate the WorkOS session" to
// "drop cookie + frontend redirect" — the AuthKit logout still
// fires, only the audit row is dropped (the
// `auth.audit.write_failure` metric covers that).
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
import { OrgRepo } from "../../../infrastructure/db/orgRepo";
import { UserRepo } from "../../../infrastructure/db/userRepo";
import { createWorkOSClient } from "../../../infrastructure/workos/client";
import { safeAudit } from "../../_audit-context";
import { extractSourceIp } from "../_shared/auditContext";
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

      // Resolve a verified actor for the audit row via the
      // authenticate-then-refresh ladder. The access token is
      // short-lived (minutes), so the typical sign-out 30s+ after
      // the user's last page interaction lands in the refresh
      // branch — without this ladder, those audits silently drop
      // (which is exactly the case AC-US8 cares most about).
      //
      // No setSecureCookie write on a successful refresh: the user
      // is about to be signed out, so refreshing the sealed blob
      // in the browser is wasted work + a confusing trace.
      let verifiedUser: { id: string } | null = null;
      let verifiedOrganizationId: string | null = null;
      const authResult = await session.authenticate();
      if (authResult.authenticated) {
        verifiedUser = authResult.user;
        verifiedOrganizationId = authResult.organizationId ?? null;
      } else {
        const refreshResult = await session.refresh();
        if (refreshResult.authenticated) {
          verifiedUser = refreshResult.user;
          verifiedOrganizationId = refreshResult.organizationId ?? null;
        }
      }
      const logoutUrl = await session.getLogoutUrl({ returnTo });

      if (verifiedUser) {
        // Isolated try/catch — a DB outage here must NOT unwind
        // the already-computed `logoutUrl`. Lead R: pre-Lead-F the
        // handler never touched the DB, so DB outages couldn't
        // downgrade sign-out semantics. This inner block restores
        // that invariant.
        try {
          const db = getDb(Resource.PLANETSCALE_DATABASE_URL.value);
          const userRepo = new UserRepo(db);
          const orgRepo = new OrgRepo(db);
          const auditRepo = new AuditRepo(db);
          const localUser = await userRepo.findByWorkosUserId(verifiedUser.id);
          const localOrg =
            localUser && verifiedOrganizationId
              ? await orgRepo.findByWorkosOrgId(verifiedOrganizationId)
              : null;
          await safeAudit(
            { auditRepo },
            {
              eventType: "logout",
              outcome: "success",
              actorUserId: localUser?.id ?? null,
              targetUserId: localUser?.id ?? null,
              orgId: localOrg?.id ?? null,
              sourceIp: extractSourceIp(request.headers.get("x-forwarded-for")),
              userAgent: request.headers.get("user-agent") ?? "unknown",
              metadata: { workosUserId: verifiedUser.id },
            },
          );
        } catch {
          // Swallow: the WorkOS-side logout MUST still fire. The
          // `auth.audit.write_failure` metric will catch the
          // dropped audit row for operator follow-up.
        }
      }

      cookie.wos_session.remove();
      return redirect(logoutUrl);
    } catch {
      // Sealed-session decode failed (e.g. cookiePassword rotated
      // mid-session, malformed cookie) — or `session.refresh()`
      // threw at the SDK boundary. Best-effort: drop the cookie
      // locally so the user's next request is clean, then bounce
      // them to the frontend.
      cookie.wos_session.remove();
      return redirect(returnTo);
    }
  },
);
