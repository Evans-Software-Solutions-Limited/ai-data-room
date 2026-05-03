// Unit tests for `requestPasswordReset` / `handlePasswordResetCompleted`.
//
// Mocks `WorkOSClient` + `UserRepo`; real `recordAuditEvent` against
// a mocked `AuditRepo` — same pattern as `suspension.test.ts`. We
// exercise the validation + NFR8-stripping pipeline that every
// audit-emitting flow now goes through.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Session, WorkOSClient } from "../../infrastructure/workos/client";
import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { UserRepo } from "../../infrastructure/db/userRepo";
import type { User } from "@ai-data-room/api-utils/schemas/auth-orgs";

import {
  handlePasswordResetCompleted,
  PasswordResetCompletionError,
  PasswordResetRequestError,
  requestPasswordReset,
} from "../password-reset";

const NOW = new Date("2026-05-02T10:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKOS_USER_ID = "user_workos_target";
const EMAIL = "user@example.com";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    workosUserId: WORKOS_USER_ID,
    email: EMAIL,
    fullName: "Target User",
    lifecycleState: "active",
    emailVerifiedAt: NOW,
    mfaEnrolledAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeSession(
  id: string,
  status: Session["status"] = "active",
): Session {
  return {
    object: "session",
    id,
    userId: WORKOS_USER_ID,
    ipAddress: null,
    userAgent: null,
    authMethod: "password",
    status,
    expiresAt: "2026-05-03T10:00:00Z",
    endedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

interface MockDeps {
  workos: WorkOSClient;
  sendPasswordResetEmail: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  revokeSession: ReturnType<typeof vi.fn>;
  userRepo: UserRepo;
  findByWorkosUserId: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const sendPasswordResetEmail = vi.fn().mockResolvedValue(undefined);
  const listSessions = vi.fn().mockResolvedValue([]);
  const revokeSession = vi.fn().mockResolvedValue(undefined);
  const findByWorkosUserId = vi.fn();
  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  return {
    workos: {
      sendPasswordResetEmail,
      listSessions,
      revokeSession,
    } as unknown as WorkOSClient,
    sendPasswordResetEmail,
    listSessions,
    revokeSession,
    userRepo: { findByWorkosUserId } as unknown as UserRepo,
    findByWorkosUserId,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

const AUDIT_CTX = { sourceIp: "203.0.113.5", userAgent: "test/1.0" } as const;

describe("requestPasswordReset", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to WorkOS, audits success, returns acknowledged", async () => {
    const result = await requestPasswordReset(
      { email: EMAIL, audit: AUDIT_CTX },
      deps,
    );

    expect(result).toEqual({ acknowledged: true });
    expect(deps.sendPasswordResetEmail).toHaveBeenCalledWith({ email: EMAIL });
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "password_reset_requested",
        outcome: "success",
        actorUserId: null,
        targetUserId: null,
        metadata: expect.objectContaining({ email: EMAIL }),
      }),
    );
  });

  it("returns acknowledged + audits failure when WorkOS rejects (unknown email)", async () => {
    // Privacy-defence: the response shape MUST stay identical to the
    // happy path. A user enumerating accounts via this endpoint sees
    // no signal whether the email is registered.
    deps.sendPasswordResetEmail.mockRejectedValue(
      new Error("user not found in WorkOS"),
    );

    const result = await requestPasswordReset(
      { email: "ghost@example.com", audit: AUDIT_CTX },
      deps,
    );

    expect(result).toEqual({ acknowledged: true });
    // Positive-shape assertion: the metadata must contain ONLY the
    // email + a generic reason. Pinning the exact shape catches a
    // future leak (e.g. someone adding `error: err.message`) that a
    // looser `objectContaining` would silently let through.
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "password_reset_requested",
        outcome: "failure",
        metadata: { email: "ghost@example.com", reason: "delegate_error" },
      }),
    );
  });

  it("throws invalid_email and does not call WorkOS when email is empty / missing", async () => {
    await expect(
      requestPasswordReset({ email: "   ", audit: AUDIT_CTX }, deps),
    ).rejects.toThrow(PasswordResetRequestError);
    await expect(
      requestPasswordReset(
        { email: undefined as unknown as string, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(/invalid_email/);

    expect(deps.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(deps.auditWrite).not.toHaveBeenCalled();
  });
});

describe("handlePasswordResetCompleted", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path (FR20)", () => {
    it("revokes every active session and audits success", async () => {
      deps.findByWorkosUserId.mockResolvedValue(makeUser());
      deps.listSessions.mockResolvedValue([
        makeSession("session_a", "active"),
        makeSession("session_b", "active"),
        // Already-expired sessions are filtered out — saves a no-op
        // round-trip and surfaces the right `revokedSessions` count
        // in the audit metadata.
        makeSession("session_c", "expired"),
      ]);

      const result = await handlePasswordResetCompleted(
        { workosUserId: WORKOS_USER_ID, audit: AUDIT_CTX },
        deps,
      );

      expect(deps.listSessions).toHaveBeenCalledWith(WORKOS_USER_ID);
      expect(deps.revokeSession).toHaveBeenCalledTimes(2);
      expect(deps.revokeSession).toHaveBeenCalledWith({
        sessionId: "session_a",
      });
      expect(deps.revokeSession).toHaveBeenCalledWith({
        sessionId: "session_b",
      });
      expect(result).toEqual({
        revokedSessions: 2,
        user: expect.objectContaining({ id: USER_ID }),
      });
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "password_reset_completed",
          outcome: "success",
          targetUserId: USER_ID,
          metadata: expect.objectContaining({ revokedSessions: 2 }),
        }),
      );
    });
  });

  describe("user_not_found (webhook idempotency)", () => {
    it("returns null + audits failure without throwing", async () => {
      deps.findByWorkosUserId.mockResolvedValue(null);

      const result = await handlePasswordResetCompleted(
        { workosUserId: "user_unmirrored", audit: AUDIT_CTX },
        deps,
      );

      expect(result).toEqual({ revokedSessions: 0, user: null });
      expect(deps.listSessions).not.toHaveBeenCalled();
      expect(deps.revokeSession).not.toHaveBeenCalled();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "password_reset_completed",
          outcome: "failure",
          metadata: expect.objectContaining({
            reason: "user_not_found",
            workosUserId: "user_unmirrored",
          }),
        }),
      );
    });
  });

  describe("zero-revocations (already-revoked / no active sessions)", () => {
    it("succeeds with revokedSessions=0 when WorkOS reports no active sessions", async () => {
      // Webhook redelivery scenario: first delivery already revoked
      // every session, so the second time round there's nothing
      // active to revoke. The audit row records the duplicate; T-016
      // owns the actual at-most-once dedup at the routing layer.
      deps.findByWorkosUserId.mockResolvedValue(makeUser());
      deps.listSessions.mockResolvedValue([
        makeSession("session_a", "expired"),
      ]);

      const result = await handlePasswordResetCompleted(
        { workosUserId: WORKOS_USER_ID, audit: AUDIT_CTX },
        deps,
      );

      expect(deps.revokeSession).not.toHaveBeenCalled();
      expect(result.revokedSessions).toBe(0);
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "password_reset_completed",
          outcome: "success",
          metadata: expect.objectContaining({ revokedSessions: 0 }),
        }),
      );
    });
  });

  describe("revoke failure", () => {
    it("audits failure with the per-attempt breakdown and re-throws", async () => {
      deps.findByWorkosUserId.mockResolvedValue(makeUser());
      deps.listSessions.mockResolvedValue([makeSession("session_a")]);
      deps.revokeSession.mockRejectedValue(new Error("workos down"));

      await expect(
        handlePasswordResetCompleted(
          { workosUserId: WORKOS_USER_ID, audit: AUDIT_CTX },
          deps,
        ),
      ).rejects.toThrow(PasswordResetCompletionError);

      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "password_reset_completed",
          outcome: "failure",
          targetUserId: USER_ID,
          metadata: expect.objectContaining({
            reason: "revoke_failed",
            attempted: 1,
            succeeded: 0,
            failed: 1,
          }),
        }),
      );
      const successCalls = deps.auditWrite.mock.calls.filter(
        ([event]) => event.outcome === "success",
      );
      expect(successCalls).toHaveLength(0);
    });

    it("attempts every revoke before throwing — partial successes are still audited", async () => {
      // FR20 requires all sessions revoked. With `Promise.all`, one
      // rejection short-circuits the rest and we'd lose track of which
      // sessions actually died. `Promise.allSettled` lets every revoke
      // run; the audit row carries the per-session breakdown so an
      // operator can reconcile state on retry.
      deps.findByWorkosUserId.mockResolvedValue(makeUser());
      deps.listSessions.mockResolvedValue([
        makeSession("session_a"),
        makeSession("session_b"),
        makeSession("session_c"),
      ]);
      deps.revokeSession.mockImplementation(
        async ({ sessionId }: { sessionId: string }) => {
          if (sessionId === "session_b") throw new Error("rate limited");
        },
      );

      await expect(
        handlePasswordResetCompleted(
          { workosUserId: WORKOS_USER_ID, audit: AUDIT_CTX },
          deps,
        ),
      ).rejects.toThrow(PasswordResetCompletionError);

      expect(deps.revokeSession).toHaveBeenCalledTimes(3);
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            attempted: 3,
            succeeded: 2,
            failed: 1,
          }),
        }),
      );
    });
  });
});
