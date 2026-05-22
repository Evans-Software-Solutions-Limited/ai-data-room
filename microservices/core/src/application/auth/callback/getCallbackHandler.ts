// GET /auth/callback — OAuth flow exit point.
//
// Slice 1 / T-014a. AuthKit redirects here after the user
// completes sign-in / sign-up. The handler is intentionally thin
// (mirrors FDP's pattern):
//
//   1. Validate the `state` query parameter against the
//      `oauth_state` cookie set by the sign-in / sign-up handler.
//      A mismatch is a CSRF attempt or a stale flow → 400.
//   2. Exchange the WorkOS code for a sealed session cookie.
//      `sealSession: true` returns a single encrypted blob that
//      we store in `wos_session`; the SDK validates it on every
//      authenticated request via `loadSealedSession().authenticate()`
//      (T-015's session middleware).
//   3. Drop the `oauth_state` cookie (single-use), set
//      `wos_session`, and redirect to the web shell.
//
// What this handler deliberately does NOT do:
//   - Create / mirror the local `users` row. WorkOS is the source
//     of truth for identity (ADR-001); the mirror is created
//     lazily by `resolveActor` on the first protected request
//     after this callback redirects (sticky #34). The pre-T-014a
//     `handleSignup` / `handleLoginCallback` application
//     functions that took a `workosCode` were retired in slice 1
//     once lazy-mirror landed — they were never called from the
//     thin callback and the lazy path covers the same ground.
//   - Auto-generate an org. Org provisioning is deferred to slice 9
//     (`onboarding-flow`); the lazy-mirrored user gets `role: null`
//     and `orgId: null` from `/me` until they go through that
//     flow.

import Elysia, { t } from "elysia";
import { Resource } from "sst";

import { createWorkOSClient } from "../../../infrastructure/workos/client";
import { emitCount } from "../../../infrastructure/observability/metrics";
import {
  getPostAuthRedirectUrl,
  SESSION_COOKIE_MAX_AGE,
  setSecureCookie,
} from "../config/frontendUrl";

export const getCallbackHandler = new Elysia().get(
  "/auth/callback",
  async ({ query, cookie, redirect, set }) => {
    const { code, state } = query;

    const storedState = cookie.oauth_state.value;
    if (!storedState || state !== storedState) {
      // Either no cookie at all (browser blocked, expired, fresh
      // tab) or a state mismatch (CSRF attempt). Same response
      // shape — we don't disambiguate to avoid leaking flow
      // state to a probing client.
      emitCount("auth.login.failure");
      set.status = 400;
      return { ok: false as const, reason: "invalid_state" as const };
    }
    cookie.oauth_state.remove();

    // SDK construction is in its own try/catch and surfaces as 500.
    // A failure here means a misconfigured WorkOS client (empty
    // API key, malformed client id) — that's a server-config bug,
    // not a user auth failure. Lumping it into the same 401 catch
    // as `authenticateWithCode` would mislead the web client into
    // showing a "your credentials are wrong" message and mask
    // infrastructure problems from ops dashboards.
    let workos;
    try {
      workos = createWorkOSClient({
        apiKey: Resource.WORKOS_API_KEY.value,
        clientId: Resource.WORKOS_CLIENT_ID.value,
      });
    } catch {
      emitCount("auth.login.failure");
      set.status = 500;
      return { ok: false as const, reason: "client_init_failed" as const };
    }

    try {
      const result = await workos.authenticateWithCode({
        clientId: Resource.WORKOS_CLIENT_ID.value,
        code,
        session: {
          sealSession: true,
          cookiePassword: Resource.WORKOS_COOKIE_PASSWORD.value,
        },
      });

      if (!result.sealedSession) {
        // SDK contract: when `sealSession: true` is set,
        // `sealedSession` is non-null on success. Defensive check
        // surfaces a misconfigured cookiePassword (length < 32
        // chars) loudly here rather than as a downstream
        // `loadSealedSession` failure.
        emitCount("auth.login.failure");
        set.status = 500;
        return { ok: false as const, reason: "no_sealed_session" as const };
      }

      setSecureCookie(
        cookie.wos_session,
        result.sealedSession,
        SESSION_COOKIE_MAX_AGE,
      );

      emitCount("auth.login.success");
      return redirect(getPostAuthRedirectUrl());
    } catch {
      // Reaches here only for `authenticateWithCode` failures —
      // expired / replayed / tampered code. That's a user auth
      // failure, 401 is correct.
      emitCount("auth.login.failure");
      set.status = 401;
      return { ok: false as const, reason: "auth_failed" as const };
    }
  },
  {
    query: t.Object({
      code: t.String({ minLength: 1 }),
      state: t.String({ minLength: 1 }),
    }),
  },
);
