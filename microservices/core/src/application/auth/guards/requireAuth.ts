// requireAuth — Elysia `.resolve()` guard that gates every protected
// route on a valid WorkOS sealed session cookie.
//
// Slice 1 / T-015 + T-014b. Mirrors FDP's
// `application/auth/guards/requireAuth.ts` shape — same authenticate-
// then-refresh ladder. Reuses the module-scope WorkOS client from
// `_shared/workosClient.ts` so each warm-Lambda request hits the
// SDK without re-allocating it (the simplify pass hoisted handler
// deps; this guard was the holdout, fixed in response to PR #21
// review).
//
// Two failure modes, two response codes:
//
//   - **No cookie** → 401 `no_session`. User isn't signed in.
//
//   - **Sealed-session validation / refresh failure** → 401
//     `session_expired` (refresh ran and returned `authenticated: false`)
//     or 401 `session_invalid` (the SDK threw — corrupt blob, bad
//     cookie password, JWKS hiccup). The cookie is cleared in both
//     cases so the next request starts clean.
//
// (The previous `client_init_failed` 500 branch is gone — the SDK
// is now constructed at module load, so a malformed
// `WORKOS_API_KEY` / `WORKOS_CLIENT_ID` fails Lambda init, surfacing
// as a deploy-time issue rather than a per-request 500. That's the
// right shape: bad config is a misconfigured stack, not a
// user-recoverable condition.)
//
// On success, returns `{ user, organizationId }` into Elysia's
// context per `AuthContext`. A successful refresh ALSO writes the
// new sealed blob back to the `wos_session` cookie via the
// centralised `setSecureCookie` helper.
//
// No LRU cache. The sealed cookie blob is the cache —
// `loadSealedSession().authenticate()` is local + JWKS-cached on
// warm Lambdas, so the original 60s LRU plan was solving for a
// network round trip that doesn't exist (see design.md §Key trade-
// offs, "Session cache: revisited and dropped").

import { status, type Context } from "elysia";
import { Resource } from "sst";

import { setSecureCookie, SESSION_COOKIE_MAX_AGE } from "../config/frontendUrl";
import { workos } from "../_shared/workosClient";

interface RequireAuthInput {
  cookie: Context["cookie"];
}

/**
 * Elysia `.resolve()` callback. Returns the `AuthContext` shape
 * (merged into request context) or a `status(...)` short-circuit.
 *
 * Return type is intentionally inferred — Elysia's
 * `ElysiaCustomStatusResponse<401, ...>` narrowing doesn't widen
 * cleanly to `ReturnType<typeof status>`, and the inferred union
 * `AuthContext | ElysiaCustomStatusResponse<401, ...> | ...`
 * carries all the precision we need for downstream handlers.
 */
export async function requireAuth({ cookie }: RequireAuthInput) {
  const sessionData = cookie.wos_session.value;
  if (!sessionData || typeof sessionData !== "string") {
    return status(401, { ok: false as const, reason: "no_session" as const });
  }

  try {
    const session = workos.loadSealedSession({
      sessionData,
      cookiePassword: Resource.WORKOS_COOKIE_PASSWORD.value,
    });

    const authResult = await session.authenticate();
    if (authResult.authenticated) {
      return {
        user: authResult.user,
        organizationId: authResult.organizationId,
      };
    }

    const refreshResult = await session.refresh();
    if (!refreshResult.authenticated) {
      cookie.wos_session.remove();
      return status(401, {
        ok: false as const,
        reason: "session_expired" as const,
      });
    }

    if (refreshResult.sealedSession) {
      // SDK contract: a successful refresh returns the new sealed
      // blob. The defensive guard handles the (non-spec) case where
      // it's missing — safer to keep serving requests with the old
      // cookie still set than to silently drop the user's session.
      setSecureCookie(
        cookie.wos_session,
        refreshResult.sealedSession,
        SESSION_COOKIE_MAX_AGE,
      );
    }

    return {
      user: refreshResult.user,
      organizationId: refreshResult.organizationId,
    };
  } catch {
    // `loadSealedSession`, `authenticate`, or `refresh` threw. Most
    // likely a corrupt cookie blob, a wrong cookie password, or a
    // transient JWKS fetch failure — all user-recoverable by signing
    // in again. Clear the cookie so the next request doesn't loop.
    cookie.wos_session.remove();
    return status(401, {
      ok: false as const,
      reason: "session_invalid" as const,
    });
  }
}
