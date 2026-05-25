// `POST /e2e/auth/login` — non-production-only bootstrap that mints a
// `wos_session` cookie without going through the hosted AuthKit UI.
// Lets the Playwright suite skip the AuthKit redirect chain (which
// can't be driven headless without scraping the WorkOS UI). Mirrors
// FDP's `postE2EAuthLoginHandler` so the runbook is reusable.

import Elysia, { t } from "elysia";
import { Resource } from "sst";
import { serializeError } from "@ai-data-room/api-utils/logging";

import { createWorkOSClient } from "../../../infrastructure/workos/client";
import { logger } from "../../../infrastructure/logging/logger";
import {
  isProduction,
  SESSION_COOKIE_MAX_AGE,
  setSecureCookie,
} from "../config/frontendUrl";

export const postE2EAuthLoginHandler = new Elysia().post(
  "/e2e/auth/login",
  async ({ headers, body, cookie, set }) => {
    if (isProduction) {
      // Match Elysia's default unrouted-path 404 (text body
      // `NOT_FOUND`, `text/plain` content-type) so a future
      // refactor that accidentally removes the conditional mount
      // in `publicRoutes.ts` doesn't re-introduce the
      // body-shape fingerprint the conditional mount eliminates.
      set.status = 404;
      set.headers["content-type"] = "text/plain;charset=utf-8";
      return "NOT_FOUND";
    }

    // SST throws on `.value` access when the secret is unlinked /
    // unset — surface that as 503 so the operator sees "configure
    // the secret" rather than a 500.
    let e2eSecret: string;
    try {
      e2eSecret = Resource.E2E_AUTH_SECRET.value;
    } catch {
      set.status = 503;
      return {
        ok: false as const,
        reason: "e2e_secret_unconfigured" as const,
      };
    }

    if (headers["x-e2e-key"] !== e2eSecret) {
      set.status = 401;
      return { ok: false as const, reason: "unauthorized" as const };
    }

    try {
      const workos = createWorkOSClient({
        apiKey: Resource.WORKOS_API_KEY.value,
        clientId: Resource.WORKOS_CLIENT_ID.value,
      });
      const result = await workos.authenticateWithPassword({
        email: body.email,
        password: body.password,
        sealSession: true,
        cookiePassword: Resource.WORKOS_COOKIE_PASSWORD.value,
      });

      if (!result.sealedSession) {
        // `sealSession: true` should always populate this. Missing
        // it means the WorkOS account has a flow we don't support
        // (org-selection, MFA challenge, unverified email). Log
        // enough detail for the operator without exposing tokens.
        logger.error("e2e bootstrap returned no sealedSession", {
          hasAccessToken: typeof result.accessToken === "string",
          hasRefreshToken: typeof result.refreshToken === "string",
          authenticationMethod: result.authenticationMethod,
        });
        set.status = 500;
        return { ok: false as const, reason: "no_sealed_session" as const };
      }

      setSecureCookie(
        cookie.wos_session,
        result.sealedSession,
        SESSION_COOKIE_MAX_AGE,
      );

      return { ok: true as const };
    } catch (err) {
      logger.error("e2e bootstrap authenticateWithPassword failed", {
        error: serializeError(err),
      });
      set.status = 401;
      return { ok: false as const, reason: "auth_failed" as const };
    }
  },
  {
    headers: t.Object(
      { "x-e2e-key": t.String({ minLength: 1 }) },
      { additionalProperties: true },
    ),
    body: t.Object({
      email: t.String({ minLength: 1 }),
      password: t.String({ minLength: 1 }),
    }),
  },
);
