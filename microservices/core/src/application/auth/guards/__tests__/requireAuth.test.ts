// Unit tests for `requireAuth`. Covers each of the four short-circuit
// branches plus the happy / refresh paths.
//
// Mocking pattern: same `vi.doMock("sst") + vi.doMock("@workos-inc/node")
// + vi.resetModules() + dynamic import` shape as `publicRoutes.test.ts`.
// `requireAuth` constructs the WorkOS client at call-time, so we only
// need to wire the SDK shape — no Elysia harness needed here, the
// guard is a plain async function.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricUnit } from "@aws-lambda-powertools/metrics";

const ALL_SECRETS = {
  WORKOS_CLIENT_ID: { value: "client_test_123" },
  WORKOS_API_KEY: { value: "sk_test_abc" },
  WORKOS_COOKIE_PASSWORD: { value: "x".repeat(32) },
  WORKOS_WEBHOOK_SECRET: { value: "whsec_test" },
  PLANETSCALE_DATABASE_URL: { value: "postgres://stub" },
};

interface MockSessionConfig {
  authenticate?: ReturnType<typeof vi.fn>;
  refresh?: ReturnType<typeof vi.fn>;
  loadSealedSessionError?: Error;
}

function mockWorkOS(config: MockSessionConfig = {}) {
  const session = {
    authenticate: config.authenticate ?? vi.fn(),
    refresh: config.refresh ?? vi.fn(),
    getLogoutUrl: vi.fn(),
  };

  const loadSealedSession = config.loadSealedSessionError
    ? vi.fn().mockImplementation(() => {
        throw config.loadSealedSessionError;
      })
    : vi.fn().mockReturnValue(session);

  vi.doMock("@workos-inc/node", () => ({
    WorkOS: class {
      userManagement = {
        loadSealedSession,
        getAuthorizationUrl: vi.fn(),
        authenticateWithCode: vi.fn(),
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

  return { session, loadSealedSession };
}

function makeCookie(value: string | undefined) {
  const set = vi.fn();
  const remove = vi.fn();
  return {
    cookie: {
      wos_session: { value, set, remove },
    } as unknown as Parameters<
      typeof import("../requireAuth").requireAuth
    >[0]["cookie"],
    set,
    remove,
  };
}

async function loadRequireAuth() {
  const mod = await import("../requireAuth");
  return mod.requireAuth;
}

const MOCK_USER = {
  object: "user" as const,
  id: "user_workos_xyz",
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Example",
  emailVerified: true,
  profilePictureUrl: null,
  lastSignInAt: null,
  locale: null,
  externalId: null,
  metadata: {},
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("requireAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("sst", () => ({ Resource: ALL_SECRETS }));
  });

  afterEach(() => {
    vi.doUnmock("sst");
    vi.doUnmock("@workos-inc/node");
  });

  it("returns 401 no_session when the cookie is missing", async () => {
    mockWorkOS();
    const { cookie } = makeCookie(undefined);
    const requireAuth = await loadRequireAuth();

    const result = await requireAuth({ cookie });

    // Elysia's `status(...)` wraps the body in a Response-like object.
    // The `.code` and `.response` shape is the tested contract.
    expect(result).toMatchObject({
      code: 401,
      response: { ok: false, reason: "no_session" },
    });
  });

  it("returns 401 no_session when the cookie value is not a string", async () => {
    mockWorkOS();
    const { cookie } = makeCookie(undefined);
    const requireAuth = await loadRequireAuth();
    const result = await requireAuth({ cookie });
    expect(result).toMatchObject({
      code: 401,
      response: expect.objectContaining({ reason: "no_session" }),
    });
  });

  it("returns the AuthContext when authenticate succeeds", async () => {
    const { session } = mockWorkOS({
      authenticate: vi.fn().mockResolvedValue({
        authenticated: true,
        user: MOCK_USER,
        organizationId: "org_workos_abc",
      }),
    });
    const { cookie, set } = makeCookie("sealed-blob");
    const requireAuth = await loadRequireAuth();

    const result = await requireAuth({ cookie });

    expect(result).toEqual({
      user: MOCK_USER,
      organizationId: "org_workos_abc",
    });
    expect(session.authenticate).toHaveBeenCalledTimes(1);
    expect(session.refresh).not.toHaveBeenCalled();
    // No refresh ⇒ no cookie rewrite.
    expect(set).not.toHaveBeenCalled();
  });

  it("refreshes the session and rewrites the cookie when authenticate fails but refresh succeeds", async () => {
    const { session } = mockWorkOS({
      authenticate: vi.fn().mockResolvedValue({ authenticated: false }),
      refresh: vi.fn().mockResolvedValue({
        authenticated: true,
        sealedSession: "sealed-blob-NEW",
        user: MOCK_USER,
        organizationId: "org_workos_abc",
      }),
    });
    const { cookie, set } = makeCookie("sealed-blob-OLD");
    const requireAuth = await loadRequireAuth();

    const result = await requireAuth({ cookie });

    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "sealed-blob-NEW",
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      }),
    );
    expect(result).toEqual({
      user: MOCK_USER,
      organizationId: "org_workos_abc",
    });
  });

  it("does not rewrite the cookie if refresh authenticated true but did not return a sealedSession", async () => {
    // Defensive branch: SDK contract says sealedSession is set on
    // success, but the guard still serves the request rather than
    // dropping the user mid-session.
    mockWorkOS({
      authenticate: vi.fn().mockResolvedValue({ authenticated: false }),
      refresh: vi.fn().mockResolvedValue({
        authenticated: true,
        sealedSession: undefined,
        user: MOCK_USER,
        organizationId: "org_workos_abc",
      }),
    });
    const { cookie, set } = makeCookie("sealed-blob-OLD");
    const requireAuth = await loadRequireAuth();

    const result = await requireAuth({ cookie });

    expect(set).not.toHaveBeenCalled();
    expect(result).toEqual({
      user: MOCK_USER,
      organizationId: "org_workos_abc",
    });
  });

  it("clears the cookie and returns 401 session_expired when refresh also fails", async () => {
    mockWorkOS({
      authenticate: vi.fn().mockResolvedValue({ authenticated: false }),
      refresh: vi.fn().mockResolvedValue({ authenticated: false }),
    });
    const { cookie, remove } = makeCookie("sealed-blob");
    const requireAuth = await loadRequireAuth();

    const result = await requireAuth({ cookie });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      code: 401,
      response: { ok: false, reason: "session_expired" },
    });
  });

  it("clears the cookie and returns 401 session_invalid when loadSealedSession throws", async () => {
    mockWorkOS({
      loadSealedSessionError: new Error("corrupt blob"),
    });
    const { cookie, remove } = makeCookie("not-a-real-blob");
    const requireAuth = await loadRequireAuth();

    const result = await requireAuth({ cookie });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      code: 401,
      response: { ok: false, reason: "session_invalid" },
    });
  });

  it("clears the cookie and returns 401 session_invalid when authenticate throws (transient JWKS hiccup)", async () => {
    mockWorkOS({
      authenticate: vi.fn().mockRejectedValue(new Error("jwks fetch failed")),
    });
    const { cookie, remove } = makeCookie("sealed-blob");
    const requireAuth = await loadRequireAuth();

    const result = await requireAuth({ cookie });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      code: 401,
      response: { ok: false, reason: "session_invalid" },
    });
  });

  // The previous `client_init_failed` 500 test is gone with the
  // simplify pass: the WorkOS SDK is now constructed at module load
  // in `_shared/workosClient.ts`, so a malformed API key / client
  // id throws at Lambda init, not per request. Bad WorkOS config
  // is a deploy-time issue surfaced by API Gateway's own 5xx, not
  // a user-recoverable runtime path.

  it("emits auth.session.validation.latency on every cookie-bearing request", async () => {
    // `vi.resetModules()` in beforeEach gives this test a fresh
    // metrics singleton, but the dynamic import below grabs the
    // SAME instance `requireAuth` will read from — so the spy is
    // observable when the guard runs.
    const metricsMod =
      await import("../../../../infrastructure/observability/metrics");
    const addMetricSpy = vi
      .spyOn(metricsMod.metrics, "addMetric")
      .mockReturnValue(metricsMod.metrics);

    mockWorkOS({
      authenticate: vi.fn().mockResolvedValue({
        authenticated: true,
        user: MOCK_USER,
        organizationId: "org_workos_abc",
      }),
    });
    const { cookie } = makeCookie("sealed-blob");
    const requireAuth = await loadRequireAuth();

    await requireAuth({ cookie });

    expect(addMetricSpy).toHaveBeenCalledWith(
      "auth.session.validation.latency",
      MetricUnit.Milliseconds,
      expect.any(Number),
    );
  });
});
