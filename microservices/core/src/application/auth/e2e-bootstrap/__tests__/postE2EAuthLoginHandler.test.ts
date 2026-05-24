// Unit tests for `postE2EAuthLoginHandler`. Same `vi.doMock("sst") +
// vi.doMock("@workos-inc/node") + vi.resetModules() + dynamic import`
// pattern as `publicRoutes.test.ts` so we exercise the real Elysia
// stack with the SDK + secrets mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const E2E_SECRET = "shhh-very-secret";

type SecretBag = {
  WORKOS_CLIENT_ID: { value: string };
  WORKOS_API_KEY: { value: string };
  WORKOS_WEBHOOK_SECRET: { value: string };
  WORKOS_COOKIE_PASSWORD: { value: string };
  PLANETSCALE_DATABASE_URL: { value: string };
  E2E_AUTH_SECRET?: { value: string };
};

const ALL_SECRETS: SecretBag = {
  WORKOS_CLIENT_ID: { value: "client_test_123" },
  WORKOS_API_KEY: { value: "sk_test_abc" },
  WORKOS_WEBHOOK_SECRET: { value: "whsec_test" },
  WORKOS_COOKIE_PASSWORD: { value: "x".repeat(32) },
  PLANETSCALE_DATABASE_URL: { value: "postgres://stub" },
  E2E_AUTH_SECRET: { value: E2E_SECRET },
};

interface MockConfig {
  authResponse?: { sealedSession: string | null };
  authError?: Error;
}

function mockWorkOS(config: MockConfig = {}) {
  const authenticateWithPassword = config.authError
    ? vi.fn().mockRejectedValue(config.authError)
    : vi
        .fn()
        .mockResolvedValue(
          config.authResponse ?? { sealedSession: "sealed-blob-e2e" },
        );

  vi.doMock("@workos-inc/node", () => ({
    WorkOS: class {
      userManagement = {
        authenticateWithPassword,
        getAuthorizationUrl: vi.fn(),
        authenticateWithCode: vi.fn(),
        loadSealedSession: vi.fn(),
        listSessions: vi.fn(),
        revokeSession: vi.fn(),
        sendInvitation: vi.fn(),
        revokeInvitation: vi.fn(),
        createPasswordReset: vi.fn(),
        getUser: vi.fn(),
        deleteUser: vi.fn(),
      };
    },
  }));

  return { authenticateWithPassword };
}

async function loadPublicRoutes() {
  const mod = await import("../../publicRoutes");
  return mod.publicRoutes;
}

function makeLoginRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/e2e/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.5",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("postE2EAuthLoginHandler", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("sst", () => ({ Resource: ALL_SECRETS }));
  });

  afterEach(() => {
    vi.doUnmock("sst");
    vi.doUnmock("@workos-inc/node");
    delete process.env.SST_STAGE;
  });

  it("returns 404 with reason=not_found when SST_STAGE is production", async () => {
    process.env.SST_STAGE = "production";
    mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeLoginRequest(
        { email: "e2e@example.com", password: "hunter2" },
        { "x-e2e-key": E2E_SECRET },
      ),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns 503 when E2E_AUTH_SECRET is undeclared on the stage", async () => {
    // SST throws on `.value` access when a secret isn't linked.
    // The Proxy-based Resource shim used in tests can simulate this
    // by deleting the field — the handler's try/catch maps the
    // resulting error to 503.
    const secretsWithoutE2E = { ...ALL_SECRETS } as Record<
      string,
      { value: string } | undefined
    >;
    delete secretsWithoutE2E.E2E_AUTH_SECRET;
    vi.doMock("sst", () => ({
      Resource: new Proxy(secretsWithoutE2E, {
        get(target, prop: string) {
          const v = target[prop];
          if (!v)
            throw new Error(
              `Resource.${prop} is not linked to this Lambda — see infra/api.ts`,
            );
          return v;
        },
      }),
    }));
    mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeLoginRequest(
        { email: "e2e@example.com", password: "hunter2" },
        { "x-e2e-key": "anything" },
      ),
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      reason: "e2e_secret_unconfigured",
    });
  });

  it("returns 401 when x-e2e-key doesn't match the configured secret", async () => {
    mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeLoginRequest(
        { email: "e2e@example.com", password: "hunter2" },
        { "x-e2e-key": "wrong-key" },
      ),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("422s when the x-e2e-key header is missing entirely (Elysia schema)", async () => {
    mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeLoginRequest({ email: "e2e@example.com", password: "hunter2" }),
    );

    expect(res.status).toBe(422);
  });

  it("sets the sealed-session cookie on the happy path and returns ok=true", async () => {
    const { authenticateWithPassword } = mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeLoginRequest(
        { email: "e2e@example.com", password: "hunter2" },
        { "x-e2e-key": E2E_SECRET },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(authenticateWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "e2e@example.com",
        password: "hunter2",
        clientId: "client_test_123",
        session: expect.objectContaining({
          sealSession: true,
          cookiePassword: "x".repeat(32),
        }),
      }),
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("wos_session=sealed-blob-e2e");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("returns 500 no_sealed_session when WorkOS auth succeeds without sealing", async () => {
    mockWorkOS({ authResponse: { sealedSession: null } });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeLoginRequest(
        { email: "e2e@example.com", password: "hunter2" },
        { "x-e2e-key": E2E_SECRET },
      ),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      reason: "no_sealed_session",
    });
  });

  it("returns 401 auth_failed when authenticateWithPassword rejects", async () => {
    mockWorkOS({ authError: new Error("invalid credentials") });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeLoginRequest(
        { email: "e2e@example.com", password: "wrong-password" },
        { "x-e2e-key": E2E_SECRET },
      ),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "auth_failed" });
  });
});
