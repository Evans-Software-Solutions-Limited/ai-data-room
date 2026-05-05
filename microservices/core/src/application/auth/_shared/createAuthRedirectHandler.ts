// Shared body for the sign-in / sign-up handlers.
//
// Slice 1 / T-014a. The two routes differ only in three values:
// the URL path, the AuthKit `screenHint`, and the user-facing
// error string. Everything else — state generation, AuthKit URL
// construction, oauth_state cookie setup, redirect — is identical.
// The factory keeps the per-route files trivially thin
// (~5 LOC each) while preserving FDP's per-route directory shape.

import Elysia from "elysia";
import { Resource } from "sst";

import { createWorkOSClient } from "../../../infrastructure/workos/client";
import {
  getOAuthRedirectUri,
  OAUTH_STATE_COOKIE_MAX_AGE,
  setSecureCookie,
} from "../config/frontendUrl";

export interface AuthRedirectHandlerConfig {
  /** Route path mounted on the returned Elysia plugin. */
  path: `/${string}`;
  /** Lands the user on AuthKit's sign-in or sign-up form. */
  screenHint: "sign-in" | "sign-up";
  /** Body returned on 500 — keeps the user-facing error consistent
   * per route (sign-in says "Sign-in unavailable", sign-up says
   * "Sign-up unavailable"). */
  unavailableMessage: string;
}

export function createAuthRedirectHandler(
  config: AuthRedirectHandlerConfig,
): Elysia {
  return new Elysia().get(config.path, async ({ cookie, redirect, set }) => {
    // Web Crypto's `randomUUID()` (~122 bits) is plenty for OAuth
    // state — the threat model is "unguessable across one user's
    // ~10-minute auth flow", not cryptographic key material.
    // Using Web Crypto rather than `node:crypto` keeps this file's
    // transitive type graph browser-clean (the `CoreApi` type
    // leaks into `packages/web` via Eden Treaty, and web's
    // tsconfig doesn't include `@types/node`).
    const state = crypto.randomUUID();

    try {
      // SDK construction is inside the try block so a misconfigured
      // WorkOS client (e.g. empty API key string) surfaces as the
      // generic 500 message rather than as an unhandled error
      // message leaked to the user.
      const workos = createWorkOSClient({
        apiKey: Resource.WORKOS_API_KEY.value,
        clientId: Resource.WORKOS_CLIENT_ID.value,
      });
      const url = workos.getAuthorizationUrl({
        provider: "authkit",
        redirectUri: getOAuthRedirectUri(),
        state,
        screenHint: config.screenHint,
      });

      setSecureCookie(cookie.oauth_state, state, OAUTH_STATE_COOKIE_MAX_AGE);
      return redirect(url);
    } catch {
      set.status = 500;
      return config.unavailableMessage;
    }
  });
}
