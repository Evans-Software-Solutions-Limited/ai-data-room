// Unit tests for the WorkOS client wrapper.
//
// We mock `@workos-inc/node` itself so each test can assert that our
// wrapper delegates to the right SDK method with the right
// arguments. The hoisted spy pattern (`vi.hoisted`) keeps the mock
// available before module imports are resolved — required because
// the wrapper constructs `new WorkOS(...)` at factory-call time and
// vitest needs the constructor mocked first.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateWithCode,
  createPasswordReset,
  deleteUser,
  getAuthorizationUrl,
  getUser,
  revokeInvitation,
  revokeSession,
  sendInvitation,
  workosCtor,
} = vi.hoisted(() => ({
  authenticateWithCode: vi.fn(),
  createPasswordReset: vi.fn(),
  deleteUser: vi.fn(),
  getAuthorizationUrl: vi.fn(),
  getUser: vi.fn(),
  revokeInvitation: vi.fn(),
  revokeSession: vi.fn(),
  sendInvitation: vi.fn(),
  workosCtor: vi.fn(),
}));

vi.mock("@workos-inc/node", () => ({
  WorkOS: workosCtor.mockImplementation(() => ({
    userManagement: {
      authenticateWithCode,
      createPasswordReset,
      deleteUser,
      getAuthorizationUrl,
      getUser,
      revokeInvitation,
      revokeSession,
      sendInvitation,
    },
  })),
}));

import { createWorkOSClient } from "../client";

const CONFIG = {
  apiKey: "sk_test_api",
  clientId: "client_test_id",
};

describe("createWorkOSClient", () => {
  beforeEach(() => {
    workosCtor.mockClear();
    authenticateWithCode.mockReset();
    createPasswordReset.mockReset();
    deleteUser.mockReset();
    getAuthorizationUrl.mockReset();
    getUser.mockReset();
    revokeInvitation.mockReset();
    revokeSession.mockReset();
    sendInvitation.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("constructs the SDK with apiKey + clientId", () => {
    createWorkOSClient(CONFIG);
    expect(workosCtor).toHaveBeenCalledWith("sk_test_api", {
      clientId: "client_test_id",
    });
  });

  it("delegates getAuthorizationUrl synchronously", () => {
    getAuthorizationUrl.mockReturnValue("https://api.workos.com/auth?...");
    const client = createWorkOSClient(CONFIG);
    const url = client.getAuthorizationUrl({
      provider: "authkit",
      clientId: "client_test_id",
      redirectUri: "https://app.example.com/callback",
    });
    expect(url).toBe("https://api.workos.com/auth?...");
    expect(getAuthorizationUrl).toHaveBeenCalledOnce();
  });

  it("delegates authenticateWithCode and forwards the SDK response", async () => {
    const sdkResponse = {
      user: { id: "user_123", email: "alice@example.com" },
      sealedSession: "sealed",
    };
    authenticateWithCode.mockResolvedValue(sdkResponse);
    const client = createWorkOSClient(CONFIG);
    const result = await client.authenticateWithCode({
      code: "auth_code_xyz",
      clientId: "client_test_id",
    });
    expect(result).toBe(sdkResponse);
    expect(authenticateWithCode).toHaveBeenCalledWith({
      code: "auth_code_xyz",
      clientId: "client_test_id",
    });
  });

  it("delegates getUser by ID", async () => {
    getUser.mockResolvedValue({ id: "user_123", email: "alice@example.com" });
    const client = createWorkOSClient(CONFIG);
    const user = await client.getUser("user_123");
    expect(user.id).toBe("user_123");
    expect(getUser).toHaveBeenCalledWith("user_123");
  });

  it("delegates deleteUser by ID", async () => {
    deleteUser.mockResolvedValue(undefined);
    const client = createWorkOSClient(CONFIG);
    await client.deleteUser("user_123");
    expect(deleteUser).toHaveBeenCalledWith("user_123");
  });

  it("createInvitation delegates to the SDK's sendInvitation (SDK naming)", async () => {
    const fakeInvitation = {
      id: "invitation_abc",
      email: "bob@example.com",
      state: "pending",
    };
    sendInvitation.mockResolvedValue(fakeInvitation);
    const client = createWorkOSClient(CONFIG);
    const inv = await client.createInvitation({
      email: "bob@example.com",
      organizationId: "org_xyz",
    });
    expect(inv).toBe(fakeInvitation);
    expect(sendInvitation).toHaveBeenCalledWith({
      email: "bob@example.com",
      organizationId: "org_xyz",
    });
  });

  it("delegates revokeInvitation by ID", async () => {
    revokeInvitation.mockResolvedValue({
      id: "invitation_abc",
      state: "revoked",
    });
    const client = createWorkOSClient(CONFIG);
    const inv = await client.revokeInvitation("invitation_abc");
    expect(inv.state).toBe("revoked");
    expect(revokeInvitation).toHaveBeenCalledWith("invitation_abc");
  });

  it("sendPasswordResetEmail delegates to the SDK's createPasswordReset (SDK naming)", async () => {
    const fakeReset = {
      id: "pwr_abc",
      passwordResetUrl: "https://example.com/reset?token=...",
    };
    createPasswordReset.mockResolvedValue(fakeReset);
    const client = createWorkOSClient(CONFIG);
    const reset = await client.sendPasswordResetEmail({
      email: "alice@example.com",
    });
    expect(reset).toBe(fakeReset);
    expect(createPasswordReset).toHaveBeenCalledWith({
      email: "alice@example.com",
    });
  });

  it("delegates revokeSession", async () => {
    revokeSession.mockResolvedValue(undefined);
    const client = createWorkOSClient(CONFIG);
    await client.revokeSession({ sessionId: "session_xyz" });
    expect(revokeSession).toHaveBeenCalledWith({ sessionId: "session_xyz" });
  });

  it("does not construct the SDK at module load", async () => {
    // T-006 DoD: "Wrapper is side-effect free at module load".
    //
    // The static `import` at the top of this file already evaluated
    // `../client`, so a plain dynamic `import("../client")` would hit
    // the module cache and never re-execute the source. We have to
    // `resetModules()` first — that clears the cache, and the next
    // dynamic import re-runs the module body, which would invoke the
    // mocked WorkOS constructor if anything at top level constructed
    // an SDK instance. The hoisted `vi.mock` factory survives
    // `resetModules`, so the WorkOS reference still points at our
    // mock after the reset.
    vi.resetModules();
    workosCtor.mockClear();
    await import("../client");
    expect(workosCtor).not.toHaveBeenCalled();
  });
});
