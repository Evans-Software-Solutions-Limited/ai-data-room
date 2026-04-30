// Unit tests for the login-callback application function.
//
// Companion to `signup.test.ts`. Same mocking strategy: WorkOS
// client and each repo via `vi.fn()`, real `recordAuditEvent`
// against a mocked AuditRepo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthenticationResponse,
  WorkOSClient,
} from "../../infrastructure/workos/client";
import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { MembershipRepo } from "../../infrastructure/db/membershipRepo";
import type { UserRepo } from "../../infrastructure/db/userRepo";
import type { User } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { handleLoginCallback, LoginError } from "../login";

const NOW = new Date("2026-04-30T10:00:00Z");

const RETURNING_SESSION: AuthenticationResponse = {
  user: {
    object: "user",
    id: "user_workos_returning",
    email: "alice@example.com",
    emailVerified: true,
    profilePictureUrl: null,
    firstName: "Alice",
    lastName: "Example",
    lastSignInAt: NOW.toISOString(),
    locale: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: NOW.toISOString(),
    externalId: null,
    metadata: {},
  },
  organizationId: "22222222-2222-4222-8222-222222222222",
  accessToken: "at_test",
  refreshToken: "rt_test",
};

const ACTIVE_USER: User = {
  id: "11111111-1111-4111-8111-111111111111",
  workosUserId: RETURNING_SESSION.user.id,
  email: RETURNING_SESSION.user.email,
  fullName: "Alice Example",
  lifecycleState: "active",
  emailVerifiedAt: NOW,
  mfaEnrolledAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

const VALID_INPUT = {
  workosCode: "code_test",
  workosClientId: "client_test_id",
  audit: { sourceIp: "203.0.113.5", userAgent: "test/1.0" } as const,
};

interface MockDeps {
  workos: WorkOSClient;
  authenticateWithCode: ReturnType<typeof vi.fn>;
  userRepo: UserRepo;
  findByWorkosUserId: ReturnType<typeof vi.fn>;
  membershipRepo: MembershipRepo;
  findByOrgUser: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const authenticateWithCode = vi.fn().mockResolvedValue(RETURNING_SESSION);
  const findByWorkosUserId = vi.fn();
  const findByOrgUser = vi.fn();
  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  return {
    workos: { authenticateWithCode } as unknown as WorkOSClient,
    authenticateWithCode,
    userRepo: { findByWorkosUserId } as unknown as UserRepo,
    findByWorkosUserId,
    membershipRepo: { findByOrgUser } as unknown as MembershipRepo,
    findByOrgUser,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

describe("handleLoginCallback", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path — returning login (US1)", () => {
    it("looks up user by workosUserId, resolves membership, emits login_success audit", async () => {
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);
      deps.findByOrgUser.mockResolvedValue({
        id: "33333333-3333-4333-8333-333333333333",
        orgId: RETURNING_SESSION.organizationId!,
        userId: ACTIVE_USER.id,
        role: "owner",
        createdAt: NOW,
        updatedAt: NOW,
      });

      const result = await handleLoginCallback(VALID_INPUT, deps);

      expect(deps.findByWorkosUserId).toHaveBeenCalledWith(
        RETURNING_SESSION.user.id,
      );
      expect(deps.findByOrgUser).toHaveBeenCalledWith(
        RETURNING_SESSION.organizationId,
        ACTIVE_USER.id,
      );
      expect(result.user.id).toBe(ACTIVE_USER.id);
      expect(result.membership?.role).toBe("owner");

      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "login_success",
          outcome: "success",
          actorUserId: ACTIVE_USER.id,
          orgId: RETURNING_SESSION.organizationId,
        }),
      );
    });

    it("returns null membership for users with no row in the org (external)", async () => {
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);
      deps.findByOrgUser.mockResolvedValue(null);

      const result = await handleLoginCallback(VALID_INPUT, deps);

      expect(result.membership).toBeNull();
    });

    it("skips membership lookup entirely when WorkOS returns no organizationId", async () => {
      deps.authenticateWithCode.mockResolvedValue({
        ...RETURNING_SESSION,
        organizationId: undefined,
      });
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);

      const result = await handleLoginCallback(VALID_INPUT, deps);

      expect(deps.findByOrgUser).not.toHaveBeenCalled();
      expect(result.membership).toBeNull();
    });
  });

  describe("user_not_found rejection", () => {
    it("throws LoginError('user_not_found') when the local mirror is missing", async () => {
      deps.findByWorkosUserId.mockResolvedValue(null);

      await expect(handleLoginCallback(VALID_INPUT, deps)).rejects.toThrow(
        LoginError,
      );
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "login_failure",
          outcome: "failure",
          metadata: expect.objectContaining({ reason: "user_not_found" }),
        }),
      );
    });
  });

  describe("FR21(c) — user_suspended rejection", () => {
    it("rejects login for suspended users with a login_failure audit", async () => {
      deps.findByWorkosUserId.mockResolvedValue({
        ...ACTIVE_USER,
        lifecycleState: "suspended",
      });

      await expect(handleLoginCallback(VALID_INPUT, deps)).rejects.toThrow(
        /user_suspended/,
      );
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "login_failure",
          outcome: "failure",
          actorUserId: ACTIVE_USER.id,
          metadata: expect.objectContaining({
            reason: "user_suspended",
            lifecycleState: "suspended",
          }),
        }),
      );
    });

    it("rejects deleted users too — deleted is non-active", async () => {
      deps.findByWorkosUserId.mockResolvedValue({
        ...ACTIVE_USER,
        lifecycleState: "deleted",
      });
      await expect(handleLoginCallback(VALID_INPUT, deps)).rejects.toThrow(
        /user_suspended/,
      );
    });
  });

  describe("FR16 / US4 — MFA-missing rejection", () => {
    it("rejects when the local mirror has mfaEnrolledAt=null", async () => {
      deps.findByWorkosUserId.mockResolvedValue({
        ...ACTIVE_USER,
        mfaEnrolledAt: null,
      });
      await expect(handleLoginCallback(VALID_INPUT, deps)).rejects.toThrow(
        /mfa_required/,
      );
    });

    it("rejects when the pluggable predicate returns false", async () => {
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);
      await expect(
        handleLoginCallback(VALID_INPUT, {
          ...deps,
          isMfaPresent: () => false,
        }),
      ).rejects.toThrow(/mfa_required/);
    });

    it("emits login_failure audit on MFA rejection", async () => {
      deps.findByWorkosUserId.mockResolvedValue({
        ...ACTIVE_USER,
        mfaEnrolledAt: null,
      });
      await handleLoginCallback(VALID_INPUT, deps).catch(() => {});

      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "login_failure",
          outcome: "failure",
          metadata: expect.objectContaining({ reason: "mfa_required" }),
        }),
      );
    });
  });

  describe("audit-write failure does not mask the path", () => {
    it("returns the login result even if recordAuditEvent throws", async () => {
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);
      deps.findByOrgUser.mockResolvedValue(null);
      deps.auditWrite.mockRejectedValue(new Error("audit table down"));
      const result = await handleLoginCallback(VALID_INPUT, deps);
      expect(result.user.id).toBe(ACTIVE_USER.id);
    });
  });
});
