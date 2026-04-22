// Unit tests for the /_health/workos handler.
//
// We mock `sst` so we can swap Resource shapes per test without touching
// a deployed stack. The integration variant (against a real dev stack)
// lives in `scripts/check-workos-health.ts` and is run manually after
// `bun sst secret set` for each stage.
//
// Note: there is no "secret literally undefined" case. SST resolves every
// declared `sst.Secret` at deploy time and fails with `SecretMissingError`
// if any value is unset — so the handler is never invoked with a missing
// key in practice. An empty string ("") is the only failure shape we
// defend against.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let healthWorkosGetHandler: typeof import("../healthWorkosGetHandler").healthWorkosGetHandler;

type SecretBag = {
  WORKOS_CLIENT_ID: { value: string };
  WORKOS_API_KEY: { value: string };
  WORKOS_WEBHOOK_SECRET: { value: string };
  WORKOS_COOKIE_PASSWORD: { value: string };
};

function mockSstResource(secrets: SecretBag) {
  vi.doMock("sst", () => ({ Resource: secrets }));
}

async function reloadHandler() {
  const mod = await import("../healthWorkosGetHandler");
  healthWorkosGetHandler = mod.healthWorkosGetHandler;
}

const ALL_SET: SecretBag = {
  WORKOS_CLIENT_ID: { value: "client_test_123" },
  WORKOS_API_KEY: { value: "sk_test_abc" },
  WORKOS_WEBHOOK_SECRET: { value: "whsec_test" },
  WORKOS_COOKIE_PASSWORD: { value: "x".repeat(32) },
};

describe("GET /_health/workos", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("sst");
  });

  it("returns 200 with the checked secret names when all are present", async () => {
    mockSstResource(ALL_SET);
    await reloadHandler();

    const res = await healthWorkosGetHandler.handle(
      new Request("http://localhost/_health/workos"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; checked: string[] };
    expect(body.ok).toBe(true);
    expect(body.checked).toEqual(
      expect.arrayContaining([
        "WORKOS_CLIENT_ID",
        "WORKOS_API_KEY",
        "WORKOS_WEBHOOK_SECRET",
        "WORKOS_COOKIE_PASSWORD",
      ]),
    );
  });

  it("returns 503 missing_secrets when one secret is empty", async () => {
    mockSstResource({
      ...ALL_SET,
      WORKOS_API_KEY: { value: "" },
    });
    await reloadHandler();

    const res = await healthWorkosGetHandler.handle(
      new Request("http://localhost/_health/workos"),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      reason: string;
      missing: string[];
    };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("missing_secrets");
    expect(body.missing).toEqual(["WORKOS_API_KEY"]);
  });

  it("returns 503 sdk_init_failed when the WorkOS SDK throws", async () => {
    mockSstResource(ALL_SET);
    vi.doMock("@workos-inc/node", () => ({
      WorkOS: class {
        constructor() {
          throw new Error("invalid api key shape");
        }
      },
    }));
    await reloadHandler();

    const res = await healthWorkosGetHandler.handle(
      new Request("http://localhost/_health/workos"),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { reason: string; error: string };
    expect(body.reason).toBe("sdk_init_failed");
    expect(body.error).toBe("invalid api key shape");

    vi.doUnmock("@workos-inc/node");
  });
});
