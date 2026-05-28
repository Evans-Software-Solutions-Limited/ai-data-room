// Unit tests for the public auth routes (Slice 1 / T-014a).
//
// Mocks `sst` for the `Resource.*` reads and `@workos-inc/node` for
// the SDK calls — same `vi.doMock` + module-reset pattern as
// `healthWorkosGetHandler.test.ts`. Each handler is tested via the
// Elysia `handle(new Request(...))` shape; cookies travel via the
// `Cookie` request header and `Set-Cookie` response headers.
//
// What's NOT covered here: the `crypto.randomUUID()` randomness
// (it's a platform primitive — we just assert the handler called
// it via the cookie value being a UUID-shaped string) and the env
// var fallbacks in `frontendUrl.ts` (covered separately by
// integration deploy where the real env vars are set).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricUnit } from "@aws-lambda-powertools/metrics";

type SecretBag = {
  WORKOS_CLIENT_ID: { value: string };
  WORKOS_API_KEY: { value: string };
  WORKOS_WEBHOOK_SECRET: { value: string };
  WORKOS_COOKIE_PASSWORD: { value: string };
  PLANETSCALE_DATABASE_URL: { value: string };
};

const ALL_SECRETS: SecretBag = {
  WORKOS_CLIENT_ID: { value: "client_test_123" },
  WORKOS_API_KEY: { value: "sk_test_abc" },
  WORKOS_WEBHOOK_SECRET: { value: "whsec_test" },
  // The SDK requires >= 32 chars for AES-256 derivation.
  WORKOS_COOKIE_PASSWORD: { value: "x".repeat(32) },
  PLANETSCALE_DATABASE_URL: { value: "postgres://stub" },
};

function mockSst(secrets: SecretBag) {
  vi.doMock("sst", () => ({ Resource: secrets }));
  // The sign-out handler imports `UserRepo` + `AuditRepo` at module
  // load (the per-request audit emission path), and both repo files
  // import `schema` from `@ai-data-room/db`. Stub the db factory +
  // a no-op `schema` so module load succeeds; repo method calls
  // against the stub would fail, but no public-route test exercises
  // a repo method against an unmocked repo class.
  vi.doMock("@ai-data-room/db", () => ({
    getDb: vi.fn().mockReturnValue({}),
    schema: new Proxy({}, { get: () => ({}) }),
  }));
}

interface MockWorkOSConfig {
  /** What `getAuthorizationUrl` returns. */
  authorizationUrl?: string;
  /** What `authenticateWithCode` returns; null `sealedSession` to
   * exercise the missing-sealed-session branch. */
  authResponse?: { sealedSession: string | null };
  /** Make `authenticateWithCode` reject. */
  authError?: Error;
  /** What `loadSealedSession().getLogoutUrl()` returns. */
  logoutUrl?: string;
  /** What `loadSealedSession().authenticate()` returns. Default is
   * `{ authenticated: false }` so the sign-out audit branch is
   * deliberately skipped unless a test opts in. */
  sessionAuthResult?:
    | { authenticated: false }
    | {
        authenticated: true;
        user: { id: string };
        organizationId: string | null;
      };
  /** Make `loadSealedSession` throw (sealed-decode failure). */
  loadSealedSessionError?: Error;
}

function mockWorkOS(config: MockWorkOSConfig = {}) {
  const getAuthorizationUrl = vi
    .fn()
    .mockReturnValue(
      config.authorizationUrl ?? "https://authkit.example/login",
    );
  const authenticateWithCode = config.authError
    ? vi.fn().mockRejectedValue(config.authError)
    : vi
        .fn()
        .mockResolvedValue(
          config.authResponse ?? { sealedSession: "sealed-blob-abc" },
        );
  const getLogoutUrl = vi
    .fn()
    .mockResolvedValue(config.logoutUrl ?? "https://authkit.example/logout");
  const authenticate = vi
    .fn()
    .mockResolvedValue(config.sessionAuthResult ?? { authenticated: false });
  const loadSealedSession = config.loadSealedSessionError
    ? vi.fn().mockImplementation(() => {
        throw config.loadSealedSessionError;
      })
    : vi.fn().mockReturnValue({ getLogoutUrl, authenticate });

  vi.doMock("@workos-inc/node", () => ({
    WorkOS: class {
      userManagement = {
        getAuthorizationUrl,
        authenticateWithCode,
        loadSealedSession,
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

  return {
    getAuthorizationUrl,
    authenticateWithCode,
    loadSealedSession,
    getLogoutUrl,
    authenticate,
  };
}

async function loadPublicRoutes() {
  const mod = await import("../publicRoutes");
  return mod.publicRoutes;
}

// Helper: every Elysia request through `publicRoutes` flows through
// the rate-limit plugin, which refuses to serve any request without
// an x-forwarded-for header (the IP source it trusts — API Gateway
// always appends to XFF in production). Tests that exercise the
// route handlers don't care about the rate-limit gating but still
// need to satisfy it, so this helper synthesises a stable XFF.
function makeAuthRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", "203.0.113.5");
  }
  return new Request(url, { ...init, headers });
}

describe("publicRoutes — getSignInHandler", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSst(ALL_SECRETS);
  });

  afterEach(() => {
    vi.doUnmock("sst");
    vi.doUnmock("@workos-inc/node");
    vi.doUnmock("@ai-data-room/db");
    vi.doUnmock("../../../infrastructure/db/userRepo");
    vi.doUnmock("../../../infrastructure/db/auditRepo");
  });

  it("redirects to AuthKit with provider=authkit + screenHint=sign-in", async () => {
    const sdk = mockWorkOS({
      authorizationUrl: "https://authkit.example/oauth?screen=sign-in",
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-in"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://authkit.example/oauth?screen=sign-in",
    );
    expect(sdk.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "authkit",
        screenHint: "sign-in",
        redirectUri: expect.stringContaining("/auth/callback"),
        state: expect.any(String),
      }),
    );
  });

  it("sets the oauth_state cookie with HttpOnly + SameSite=Lax", async () => {
    mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-in"),
    );

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain("oauth_state=");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // Cookie value (the OAuth state token) needs >8 chars of
    // entropy — the callback handler will compare it against the
    // `state` query param. The `randomUUID()` shape is hyphen-
    // delimited hex so the regex is permissive on the character
    // class.
    expect(setCookie).toMatch(/oauth_state=[A-Za-z0-9-]{8,}/);
  });

  it("returns 500 when the WorkOS client construction throws", async () => {
    // E.g. an empty API key surfaces here.
    mockSst({
      ...ALL_SECRETS,
      WORKOS_API_KEY: { value: "" },
    });
    vi.doMock("@workos-inc/node", () => ({
      WorkOS: class {
        constructor() {
          throw new Error("invalid api key shape");
        }
      },
    }));
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-in"),
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Sign-in unavailable");
  });
});

describe("publicRoutes — getSignUpHandler", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSst(ALL_SECRETS);
  });

  afterEach(() => {
    vi.doUnmock("sst");
    vi.doUnmock("@workos-inc/node");
    vi.doUnmock("@ai-data-room/db");
    vi.doUnmock("../../../infrastructure/db/userRepo");
    vi.doUnmock("../../../infrastructure/db/auditRepo");
  });

  it("redirects to AuthKit with screenHint=sign-up (the only difference vs sign-in)", async () => {
    const sdk = mockWorkOS({
      authorizationUrl: "https://authkit.example/oauth?screen=sign-up",
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-up"),
    );

    expect(res.status).toBe(302);
    expect(sdk.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ screenHint: "sign-up" }),
    );
  });
});

describe("publicRoutes — getCallbackHandler", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSst(ALL_SECRETS);
  });

  afterEach(() => {
    vi.doUnmock("sst");
    vi.doUnmock("@workos-inc/node");
    vi.doUnmock("@ai-data-room/db");
    vi.doUnmock("../../../infrastructure/db/userRepo");
    vi.doUnmock("../../../infrastructure/db/auditRepo");
  });

  it("exchanges the code, sets wos_session, redirects, and emits auth.login.success on the happy path", async () => {
    const metricsMod =
      await import("../../../infrastructure/observability/metrics");
    const addMetricSpy = vi
      .spyOn(metricsMod.metrics, "addMetric")
      .mockReturnValue(metricsMod.metrics);

    const sdk = mockWorkOS({
      authResponse: { sealedSession: "sealed-blob-success" },
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest(
        "http://localhost/auth/callback?code=auth_code&state=tok-1",
        {
          headers: { cookie: "oauth_state=tok-1" },
        },
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:5173/");
    expect(sdk.authenticateWithCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "auth_code",
        clientId: "client_test_123",
        session: expect.objectContaining({
          sealSession: true,
          cookiePassword: ALL_SECRETS.WORKOS_COOKIE_PASSWORD.value,
        }),
      }),
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("wos_session=sealed-blob-success");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(addMetricSpy).toHaveBeenCalledWith(
      "auth.login.success",
      MetricUnit.Count,
      1,
    );
  });

  it("returns 400 + drops oauth_state when state and cookie mismatch, emits auth.login.failure", async () => {
    // CSRF defence: an attacker can guess the WorkOS code, but
    // not the state cookie. Mismatch → reject without exchanging.
    const metricsMod =
      await import("../../../infrastructure/observability/metrics");
    const addMetricSpy = vi
      .spyOn(metricsMod.metrics, "addMetric")
      .mockReturnValue(metricsMod.metrics);

    const sdk = mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest(
        "http://localhost/auth/callback?code=auth_code&state=attacker-state",
        { headers: { cookie: "oauth_state=legit-state" } },
      ),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "invalid_state" });
    expect(sdk.authenticateWithCode).not.toHaveBeenCalled();
    expect(addMetricSpy).toHaveBeenCalledWith(
      "auth.login.failure",
      MetricUnit.Count,
      1,
    );
  });

  it("returns 400 when no oauth_state cookie is present at all", async () => {
    // Same response shape as state mismatch — we don't
    // disambiguate the failure mode to avoid leaking flow state
    // to a probing client.
    const sdk = mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest(
        "http://localhost/auth/callback?code=auth_code&state=tok-1",
      ),
    );

    expect(res.status).toBe(400);
    expect(sdk.authenticateWithCode).not.toHaveBeenCalled();
  });

  it("returns 500 when the SDK returns no sealedSession despite sealSession:true", async () => {
    // Defensive: SDK contract says non-null on success but a
    // misconfigured cookiePassword (shorter than 32 chars) would
    // surface here as a missing sealed session.
    mockWorkOS({ authResponse: { sealedSession: null } });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest(
        "http://localhost/auth/callback?code=auth_code&state=tok-1",
        {
          headers: { cookie: "oauth_state=tok-1" },
        },
      ),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      reason: "no_sealed_session",
    });
  });

  it("returns 401 when authenticateWithCode rejects (bad / expired code)", async () => {
    mockWorkOS({ authError: new Error("invalid_grant") });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest(
        "http://localhost/auth/callback?code=auth_code&state=tok-1",
        {
          headers: { cookie: "oauth_state=tok-1" },
        },
      ),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "auth_failed" });
  });

  it("returns 500 client_init_failed (NOT 401) when WorkOS client construction throws", async () => {
    // Defends the Bugbot finding on PR #19: a misconfigured API
    // key was previously misclassified as 401 auth_failed (user
    // problem) when it's actually a 500 server-config bug. The
    // split try/catch in the handler keeps the two failure modes
    // distinct so client-side error UX and ops dashboards see the
    // right shape.
    vi.doMock("@workos-inc/node", () => ({
      WorkOS: class {
        constructor() {
          throw new Error("invalid api key shape");
        }
      },
    }));
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest(
        "http://localhost/auth/callback?code=auth_code&state=tok-1",
        {
          headers: { cookie: "oauth_state=tok-1" },
        },
      ),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      reason: "client_init_failed",
    });
  });

  it("422s when the query is missing code or state (Elysia schema validation)", async () => {
    mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/callback"),
    );

    // Elysia returns a validation error status (422 by default).
    // We just assert the handler didn't reach the 400 / 401 / 200
    // branches — schema rejection is the right shape for missing
    // query params.
    expect([400, 422]).toContain(res.status);
  });
});

describe("publicRoutes — getSignOutHandler", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSst(ALL_SECRETS);
  });

  afterEach(() => {
    vi.doUnmock("sst");
    vi.doUnmock("@workos-inc/node");
    vi.doUnmock("@ai-data-room/db");
    vi.doUnmock("../../../infrastructure/db/userRepo");
    vi.doUnmock("../../../infrastructure/db/auditRepo");
  });

  it("redirects to the AuthKit logout URL when the cookie is valid", async () => {
    const sdk = mockWorkOS({
      logoutUrl: "https://authkit.example/logout?return=http://localhost:5173",
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-out", {
        headers: { cookie: "wos_session=sealed-blob-current" },
      }),
    );

    expect(sdk.loadSealedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionData: "sealed-blob-current",
        cookiePassword: ALL_SECRETS.WORKOS_COOKIE_PASSWORD.value,
      }),
    );
    // The redirect helper produces the raw URL without the
    // trailing slash that fetch / Elysia normalize into the
    // response Location header. We assert against the source
    // shape here.
    expect(sdk.getLogoutUrl).toHaveBeenCalledWith({
      returnTo: "http://localhost:5173",
    });
    expect(res.headers.get("location")).toBe(
      "https://authkit.example/logout?return=http://localhost:5173",
    );
    // Cookie cleared via Set-Cookie with empty value + past
    // Expires (Elysia's `.remove()` shape).
    expect(res.headers.get("set-cookie") ?? "").toContain("wos_session=");
  });

  it("redirects to the frontend without touching the SDK when there's no session cookie", async () => {
    const sdk = mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-out"),
    );

    expect(sdk.loadSealedSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://localhost:5173/");
  });

  it("clears the cookie + redirects to the frontend when sealed-session decode throws", async () => {
    // Defends the catch branch — e.g. the cookie password rotated
    // mid-session, or the cookie is malformed. Better to clear and
    // redirect than to wedge the user in a 500.
    mockWorkOS({
      loadSealedSessionError: new Error("malformed sealed payload"),
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-out", {
        headers: { cookie: "wos_session=corrupt-blob" },
      }),
    );

    expect(res.headers.get("location")).toBe("http://localhost:5173/");
    expect(res.headers.get("set-cookie") ?? "").toContain("wos_session=");
  });

  it("emits a `logout` audit event tied to the local user on a valid sign-out (FR13 / AC-US8)", async () => {
    // FR13 + AC-US8 require an audit row keyed to the user signing
    // out. The handler resolves the local UUID via
    // `userRepo.findByWorkosUserId` and emits via `safeAudit`; this
    // test mocks both deps and asserts the canonical shape.
    const auditWrite = vi.fn().mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000099",
      occurredAt: new Date(),
    });
    vi.doMock("../../../infrastructure/db/auditRepo", () => ({
      AuditRepo: class {
        write = auditWrite;
      },
    }));
    const userFindByWorkosUserId = vi.fn().mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      workosUserId: "user_wos_42",
      email: "alice@example.com",
    });
    vi.doMock("../../../infrastructure/db/userRepo", () => ({
      UserRepo: class {
        findByWorkosUserId = userFindByWorkosUserId;
      },
    }));

    const sdk = mockWorkOS({
      sessionAuthResult: {
        authenticated: true,
        user: { id: "user_wos_42" },
        organizationId: null,
      },
      logoutUrl: "https://authkit.example/logout?return=http://localhost:5173",
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-out", {
        headers: {
          cookie: "wos_session=sealed-blob",
          "user-agent": "test-agent",
        },
      }),
    );

    expect(res.headers.get("location")).toBe(
      "https://authkit.example/logout?return=http://localhost:5173",
    );
    expect(sdk.authenticate).toHaveBeenCalledTimes(1);
    expect(userFindByWorkosUserId).toHaveBeenCalledWith("user_wos_42");
    expect(auditWrite).toHaveBeenCalledTimes(1);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "logout",
        outcome: "success",
        actorUserId: "11111111-1111-4111-8111-111111111111",
        targetUserId: "11111111-1111-4111-8111-111111111111",
        sourceIp: "203.0.113.5",
        userAgent: "test-agent",
        metadata: { workosUserId: "user_wos_42" },
      }),
    );
  });

  it("emits a `logout` audit with actorUserId=null when the user has no local mirror yet (fresh-signup sign-out)", async () => {
    // Fresh signup → callback set sealed cookie → user signs out
    // before ever hitting a protected route → no lazy-mirror row
    // exists (sticky #34). AC-US8 still requires the audit row.
    // Schema permits null actor_user_id; `metadata.workosUserId`
    // carries the joinable id.
    const auditWrite = vi.fn().mockResolvedValue({
      id: "00000000-0000-0000-0000-0000000000aa",
      occurredAt: new Date(),
    });
    vi.doMock("../../../infrastructure/db/auditRepo", () => ({
      AuditRepo: class {
        write = auditWrite;
      },
    }));
    const userFindByWorkosUserId = vi.fn().mockResolvedValue(null);
    vi.doMock("../../../infrastructure/db/userRepo", () => ({
      UserRepo: class {
        findByWorkosUserId = userFindByWorkosUserId;
      },
    }));

    const sdk = mockWorkOS({
      sessionAuthResult: {
        authenticated: true,
        user: { id: "user_wos_freshly_signed_up" },
        organizationId: null,
      },
      logoutUrl: "https://authkit.example/logout?return=http://localhost:5173",
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-out", {
        headers: { cookie: "wos_session=sealed-blob-fresh" },
      }),
    );

    expect(res.headers.get("location")).toBe(
      "https://authkit.example/logout?return=http://localhost:5173",
    );
    expect(sdk.authenticate).toHaveBeenCalledTimes(1);
    expect(userFindByWorkosUserId).toHaveBeenCalledWith(
      "user_wos_freshly_signed_up",
    );
    expect(auditWrite).toHaveBeenCalledTimes(1);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "logout",
        outcome: "success",
        actorUserId: null,
        targetUserId: null,
        metadata: { workosUserId: "user_wos_freshly_signed_up" },
      }),
    );
  });

  it("skips audit emission when the sealed session is expired (authenticated: false)", async () => {
    // Default mockWorkOS returns authenticate → { authenticated: false }.
    // Sign-out still succeeds (the cookie is still parseable, getLogoutUrl
    // works), but no audit row lands — we don't have a verified actor.
    const auditWrite = vi.fn();
    vi.doMock("../../../infrastructure/db/auditRepo", () => ({
      AuditRepo: class {
        write = auditWrite;
      },
    }));
    const sdk = mockWorkOS({
      logoutUrl: "https://authkit.example/logout?return=http://localhost:5173",
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      makeAuthRequest("http://localhost/auth/sign-out", {
        headers: { cookie: "wos_session=sealed-blob-expired" },
      }),
    );

    expect(res.headers.get("location")).toBe(
      "https://authkit.example/logout?return=http://localhost:5173",
    );
    expect(sdk.authenticate).toHaveBeenCalledTimes(1);
    expect(auditWrite).not.toHaveBeenCalled();
  });
});
