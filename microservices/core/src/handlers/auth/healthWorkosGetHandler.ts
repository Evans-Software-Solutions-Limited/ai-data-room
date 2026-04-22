// GET /_health/workos
//
// Internal-only smoke test that proves WorkOS secrets are wired into
// this Lambda. Lands as part of auth-and-orgs T-002. REMOVED in T-015
// (replaced by GET /me once session middleware exists).
//
// Returns 200 with the list of secrets it verified, or 503 with details
// of what's missing or what failed.
//
// Deliberately does NOT make an outbound WorkOS API call — that would
// turn a dependency-free health check into a flaky probe. The dev-stack
// integration script in `scripts/check-workos-health.ts` makes the real
// call after deploy.

import Elysia, { t } from "elysia";
import { Resource } from "sst";
import { WorkOS } from "@workos-inc/node";

// Readers, not values. Evaluated per request so the test suite can
// remock `sst` between cases via `vi.doMock("sst", ...)` + module
// reset. Each reader accesses the concrete typed Resource property —
// no casts, no string-index lookup — so the compiler refuses the
// handler if `sst-env.d.ts` doesn't include the full WorkOS set.
const WORKOS_SECRET_READERS = {
  WORKOS_CLIENT_ID: () => Resource.WORKOS_CLIENT_ID.value,
  WORKOS_API_KEY: () => Resource.WORKOS_API_KEY.value,
  WORKOS_WEBHOOK_SECRET: () => Resource.WORKOS_WEBHOOK_SECRET.value,
  WORKOS_COOKIE_PASSWORD: () => Resource.WORKOS_COOKIE_PASSWORD.value,
} as const satisfies Record<string, () => string>;

type RequiredSecret = keyof typeof WORKOS_SECRET_READERS;

const REQUIRED_SECRETS = Object.keys(WORKOS_SECRET_READERS) as RequiredSecret[];

function readSecret(name: RequiredSecret): string | null {
  const value = WORKOS_SECRET_READERS[name]();
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const healthWorkosGetHandler = new Elysia().get(
  "/_health/workos",
  ({ set }) => {
    const missing: RequiredSecret[] = [];
    for (const name of REQUIRED_SECRETS) {
      if (readSecret(name) === null) missing.push(name);
    }

    if (missing.length > 0) {
      set.status = 503;
      return {
        ok: false as const,
        reason: "missing_secrets" as const,
        missing,
      };
    }

    // Validates that the WorkOS SDK accepts the configured key + client
    // id shapes. Doesn't issue a network call (see file-level note).
    try {
      new WorkOS(readSecret("WORKOS_API_KEY")!, {
        clientId: readSecret("WORKOS_CLIENT_ID")!,
      });
    } catch (err) {
      set.status = 503;
      return {
        ok: false as const,
        reason: "sdk_init_failed" as const,
        error: err instanceof Error ? err.message : "unknown",
      };
    }

    return {
      ok: true as const,
      checked: [...REQUIRED_SECRETS],
    };
  },
  {
    response: {
      200: t.Object({
        ok: t.Literal(true),
        checked: t.Array(t.String()),
      }),
      503: t.Union([
        t.Object({
          ok: t.Literal(false),
          reason: t.Literal("missing_secrets"),
          missing: t.Array(t.String()),
        }),
        t.Object({
          ok: t.Literal(false),
          reason: t.Literal("sdk_init_failed"),
          error: t.String(),
        }),
      ]),
    },
    detail: {
      summary: "WorkOS wiring health check (T-002, removed in T-015).",
      tags: ["health", "internal"],
    },
  },
);
