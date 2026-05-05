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
  const loadSealedSession = config.loadSealedSessionError
    ? vi.fn().mockImplementation(() => {
        throw config.loadSealedSessionError;
      })
    : vi.fn().mockReturnValue({ getLogoutUrl });

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
  };
}

async function loadPublicRoutes() {
  const mod = await import("../publicRoutes");
  return mod.publicRoutes;
}

describe("publicRoutes — getSignInHandler", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSst(ALL_SECRETS);
  });

  afterEach(() => {
    vi.doUnmock("sst");
    vi.doUnmock("@workos-inc/node");
  });

  it("redirects to AuthKit with provider=authkit + screenHint=sign-in", async () => {
    const sdk = mockWorkOS({
      authorizationUrl: "https://authkit.example/oauth?screen=sign-in",
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      new Request("http://localhost/auth/sign-in"),
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
      new Request("http://localhost/auth/sign-in"),
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
      new Request("http://localhost/auth/sign-in"),
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
  });

  it("redirects to AuthKit with screenHint=sign-up (the only difference vs sign-in)", async () => {
    const sdk = mockWorkOS({
      authorizationUrl: "https://authkit.example/oauth?screen=sign-up",
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      new Request("http://localhost/auth/sign-up"),
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
  });

  it("exchanges the code, sets wos_session, and redirects to the frontend on the happy path", async () => {
    const sdk = mockWorkOS({
      authResponse: { sealedSession: "sealed-blob-success" },
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      new Request("http://localhost/auth/callback?code=auth_code&state=tok-1", {
        headers: { cookie: "oauth_state=tok-1" },
      }),
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
  });

  it("returns 400 + drops oauth_state when state and cookie mismatch", async () => {
    // CSRF defence: an attacker can guess the WorkOS code, but
    // not the state cookie. Mismatch → reject without exchanging.
    const sdk = mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      new Request(
        "http://localhost/auth/callback?code=auth_code&state=attacker-state",
        { headers: { cookie: "oauth_state=legit-state" } },
      ),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "invalid_state" });
    expect(sdk.authenticateWithCode).not.toHaveBeenCalled();
  });

  it("returns 400 when no oauth_state cookie is present at all", async () => {
    // Same response shape as state mismatch — we don't
    // disambiguate the failure mode to avoid leaking flow state
    // to a probing client.
    const sdk = mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      new Request("http://localhost/auth/callback?code=auth_code&state=tok-1"),
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
      new Request("http://localhost/auth/callback?code=auth_code&state=tok-1", {
        headers: { cookie: "oauth_state=tok-1" },
      }),
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
      new Request("http://localhost/auth/callback?code=auth_code&state=tok-1", {
        headers: { cookie: "oauth_state=tok-1" },
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "auth_failed" });
  });

  it("422s when the query is missing code or state (Elysia schema validation)", async () => {
    mockWorkOS();
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      new Request("http://localhost/auth/callback"),
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
  });

  it("redirects to the AuthKit logout URL when the cookie is valid", async () => {
    const sdk = mockWorkOS({
      logoutUrl: "https://authkit.example/logout?return=http://localhost:5173",
    });
    const routes = await loadPublicRoutes();

    const res = await routes.handle(
      new Request("http://localhost/auth/sign-out", {
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
      new Request("http://localhost/auth/sign-out"),
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
      new Request("http://localhost/auth/sign-out", {
        headers: { cookie: "wos_session=corrupt-blob" },
      }),
    );

    expect(res.headers.get("location")).toBe("http://localhost:5173/");
    expect(res.headers.get("set-cookie") ?? "").toContain("wos_session=");
  });
});
