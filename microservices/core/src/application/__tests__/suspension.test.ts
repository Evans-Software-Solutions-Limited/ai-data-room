// Unit tests for `suspendUser` / `unsuspendUser`.
//
// Mocks WorkOSClient + each repo via vi.fn(); real `recordAuditEvent`
// against a mocked AuditRepo so we exercise the validation +
// NFR8-stripping pipeline that every audit-emitting flow now goes
// through.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Session, WorkOSClient } from "../../infrastructure/workos/client";
import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { MembershipRepo } from "../../infrastructure/db/membershipRepo";
import type { UserRepo } from "../../infrastructure/db/userRepo";
import type {
  OrgMembership,
  User,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { SuspensionError, suspendUser, unsuspendUser } from "../suspension";

const NOW = new Date("2026-05-01T10:00:00Z");
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "44444444-4444-4444-8444-444444444444";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: TARGET_ID,
    workosUserId: "user_workos_target",
    email: "target@example.com",
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
    userId: "user_workos_target",
    ipAddress: null,
    userAgent: null,
    authMethod: "password",
    status,
    expiresAt: "2026-05-02T10:00:00Z",
    endedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

interface MockDeps {
  workos: WorkOSClient;
  listSessions: ReturnType<typeof vi.fn>;
  revokeSession: ReturnType<typeof vi.fn>;
  userRepo: UserRepo;
  findById: ReturnType<typeof vi.fn>;
  setLifecycleState: ReturnType<typeof vi.fn>;
  membershipRepo: MembershipRepo;
  findOwnerForOrg: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const listSessions = vi.fn().mockResolvedValue([]);
  const revokeSession = vi.fn().mockResolvedValue(undefined);
  const findById = vi.fn();
  const setLifecycleState = vi.fn();
  const findOwnerForOrg = vi.fn().mockResolvedValue(null);
  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  return {
    workos: { listSessions, revokeSession } as unknown as WorkOSClient,
    listSessions,
    revokeSession,
    userRepo: { findById, setLifecycleState } as unknown as UserRepo,
    findById,
    setLifecycleState,
    membershipRepo: { findOwnerForOrg } as unknown as MembershipRepo,
    findOwnerForOrg,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

const VALID_INPUT = {
  actorId: ACTOR_ID,
  targetId: TARGET_ID,
  orgId: ORG_ID,
  audit: { sourceIp: "203.0.113.5", userAgent: "test/1.0" } as const,
};

describe("suspendUser", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path (FR21)", () => {
    it("revokes every active session, flips lifecycle, audits user_suspended", async () => {
      deps.findById.mockResolvedValue(makeUser());
      deps.listSessions.mockResolvedValue([
        makeSession("session_a", "active"),
        makeSession("session_b", "active"),
        // Already-expired sessions are not revoked — saves a no-op
        // round-trip and surfaces the right `revokedSessions` count
        // in the audit metadata.
        makeSession("session_c", "expired"),
      ]);
      deps.setLifecycleState.mockResolvedValue(
        makeUser({ lifecycleState: "suspended" }),
      );

      const result = await suspendUser(VALID_INPUT, deps);

      expect(deps.revokeSession).toHaveBeenCalledTimes(2);
      expect(deps.revokeSession).toHaveBeenCalledWith({
        sessionId: "session_a",
      });
      expect(deps.revokeSession).toHaveBeenCalledWith({
        sessionId: "session_b",
      });
      expect(deps.setLifecycleState).toHaveBeenCalledWith(
        TARGET_ID,
        "suspended",
      );
      expect(result.lifecycleState).toBe("suspended");
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "user_suspended",
          outcome: "success",
          actorUserId: ACTOR_ID,
          targetUserId: TARGET_ID,
          orgId: ORG_ID,
          metadata: expect.objectContaining({ revokedSessions: 2 }),
        }),
      );
    });

    it("succeeds with zero revocations when WorkOS reports no active sessions", async () => {
      deps.findById.mockResolvedValue(makeUser());
      deps.listSessions.mockResolvedValue([]);
      deps.setLifecycleState.mockResolvedValue(
        makeUser({ lifecycleState: "suspended" }),
      );

      await suspendUser(VALID_INPUT, deps);

      expect(deps.revokeSession).not.toHaveBeenCalled();
      expect(deps.setLifecycleState).toHaveBeenCalled();
    });
  });

  describe("FR21(b) timing — session-revocation completes before lifecycle flip", () => {
    it("awaits every revokeSession before calling setLifecycleState", async () => {
      // Defends the spec's "session-revocation call happens before
      // the handler returns" requirement. We assert call order via
      // `mock.invocationCallOrder`: the lifecycle flip must come
      // after every revoke. A bug where revoke was fire-and-forget
      // (or sequenced after setLifecycleState) would flip the
      // ordering.
      deps.findById.mockResolvedValue(makeUser());
      deps.listSessions.mockResolvedValue([
        makeSession("session_a"),
        makeSession("session_b"),
      ]);
      deps.setLifecycleState.mockResolvedValue(
        makeUser({ lifecycleState: "suspended" }),
      );

      await suspendUser(VALID_INPUT, deps);

      const revokeOrders = deps.revokeSession.mock.invocationCallOrder;
      const setStateOrder = deps.setLifecycleState.mock.invocationCallOrder[0];
      expect(revokeOrders).toHaveLength(2);
      // Every revoke must have been called before the lifecycle flip.
      for (const order of revokeOrders) {
        expect(order).toBeLessThan(setStateOrder!);
      }
    });

    it("does not flip lifecycle if a revoke throws — DB stays consistent", async () => {
      deps.findById.mockResolvedValue(makeUser());
      deps.listSessions.mockResolvedValue([makeSession("session_a")]);
      deps.revokeSession.mockRejectedValue(new Error("workos down"));

      await expect(suspendUser(VALID_INPUT, deps)).rejects.toThrow(
        /workos down/,
      );
      expect(deps.setLifecycleState).not.toHaveBeenCalled();
    });
  });

  describe("FR23 self-suspension prevention", () => {
    it("throws self_suspension when actor === target", async () => {
      await expect(
        suspendUser(
          { ...VALID_INPUT, actorId: TARGET_ID, targetId: TARGET_ID },
          deps,
        ),
      ).rejects.toThrow(SuspensionError);
      expect(deps.findById).not.toHaveBeenCalled();
      expect(deps.revokeSession).not.toHaveBeenCalled();
      expect(deps.setLifecycleState).not.toHaveBeenCalled();
    });

    it("emits user_suspended audit with outcome=failure + reason=self_suspension", async () => {
      await suspendUser(
        { ...VALID_INPUT, actorId: TARGET_ID, targetId: TARGET_ID },
        deps,
      ).catch(() => {});
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "user_suspended",
          outcome: "failure",
          metadata: expect.objectContaining({ reason: "self_suspension" }),
        }),
      );
    });
  });

  describe("FR23 sole-owner protection", () => {
    it("throws sole_owner_protection when target is the org's only owner", async () => {
      deps.findById.mockResolvedValue(makeUser({ id: OWNER_ID }));
      const ownerMembership: OrgMembership = {
        id: "55555555-5555-4555-8555-555555555555",
        orgId: ORG_ID,
        userId: OWNER_ID,
        role: "owner",
        createdAt: NOW,
        updatedAt: NOW,
      };
      deps.findOwnerForOrg.mockResolvedValue(ownerMembership);

      await expect(
        suspendUser({ ...VALID_INPUT, targetId: OWNER_ID }, deps),
      ).rejects.toThrow(SuspensionError);

      expect(deps.revokeSession).not.toHaveBeenCalled();
      expect(deps.setLifecycleState).not.toHaveBeenCalled();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "user_suspended",
          outcome: "failure",
          metadata: expect.objectContaining({
            reason: "sole_owner_protection",
          }),
        }),
      );
    });

    it("permits suspension when target is not the owner (admin or internal)", async () => {
      deps.findById.mockResolvedValue(makeUser());
      deps.findOwnerForOrg.mockResolvedValue({
        id: "55555555-5555-4555-8555-555555555555",
        orgId: ORG_ID,
        userId: OWNER_ID, // Different from target
        role: "owner" as const,
        createdAt: NOW,
        updatedAt: NOW,
      });
      deps.setLifecycleState.mockResolvedValue(
        makeUser({ lifecycleState: "suspended" }),
      );

      await expect(suspendUser(VALID_INPUT, deps)).resolves.not.toThrow();
    });
  });

  describe("user_not_found rejection", () => {
    it("throws user_not_found when the target user is missing", async () => {
      deps.findById.mockResolvedValue(null);
      await expect(suspendUser(VALID_INPUT, deps)).rejects.toThrow(
        /user_not_found/,
      );
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "user_suspended",
          outcome: "failure",
          metadata: expect.objectContaining({ reason: "user_not_found" }),
        }),
      );
    });
  });
});

describe("unsuspendUser", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("flips lifecycle back to active and audits user_unsuspended", async () => {
    deps.findById.mockResolvedValue(makeUser({ lifecycleState: "suspended" }));
    deps.setLifecycleState.mockResolvedValue(
      makeUser({ lifecycleState: "active" }),
    );

    const result = await unsuspendUser(VALID_INPUT, deps);

    expect(deps.setLifecycleState).toHaveBeenCalledWith(TARGET_ID, "active");
    expect(result.lifecycleState).toBe("active");
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user_unsuspended",
        outcome: "success",
        actorUserId: ACTOR_ID,
        targetUserId: TARGET_ID,
        orgId: ORG_ID,
      }),
    );
  });

  it("does NOT touch WorkOS sessions on un-suspend", async () => {
    // The suspension already revoked them; user has to log in
    // again to mint new sessions. There's nothing to revoke here.
    deps.findById.mockResolvedValue(makeUser({ lifecycleState: "suspended" }));
    deps.setLifecycleState.mockResolvedValue(makeUser());
    await unsuspendUser(VALID_INPUT, deps);
    expect(deps.listSessions).not.toHaveBeenCalled();
    expect(deps.revokeSession).not.toHaveBeenCalled();
  });

  it("throws user_not_found if target is missing + emits failure audit", async () => {
    deps.findById.mockResolvedValue(null);
    await expect(unsuspendUser(VALID_INPUT, deps)).rejects.toThrow(
      /user_not_found/,
    );
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user_unsuspended",
        outcome: "failure",
        metadata: expect.objectContaining({ reason: "user_not_found" }),
      }),
    );
  });
});
