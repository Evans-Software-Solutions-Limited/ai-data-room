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
import type { OrgRepo } from "../../infrastructure/db/orgRepo";
import type { UserRepo } from "../../infrastructure/db/userRepo";
import type { Org, User } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { handleLoginCallback, LoginError } from "../login";

const NOW = new Date("2026-04-30T10:00:00Z");

// WorkOS-style id (text, prefixed) — NOT a UUID. The local
// `organizations.id` UUID is something else (`LOCAL_ORG.id` below);
// the `findByWorkosOrgId` lookup is what bridges the two.
const WORKOS_ORG_ID = "org_01EXAMPLE_RETURNING";
const LOCAL_ORG_ID = "22222222-2222-4222-8222-222222222222";

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
  organizationId: WORKOS_ORG_ID,
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

const LOCAL_ORG: Org = {
  id: LOCAL_ORG_ID,
  workosOrgId: WORKOS_ORG_ID,
  name: "Capital Pay",
  slug: "capital-pay",
  status: "active",
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
  orgRepo: OrgRepo;
  findByWorkosOrgId: ReturnType<typeof vi.fn>;
  membershipRepo: MembershipRepo;
  findByOrgUser: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const authenticateWithCode = vi.fn().mockResolvedValue(RETURNING_SESSION);
  const findByWorkosUserId = vi.fn();
  const findByWorkosOrgId = vi.fn();
  const findByOrgUser = vi.fn();
  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  return {
    workos: { authenticateWithCode } as unknown as WorkOSClient,
    authenticateWithCode,
    userRepo: { findByWorkosUserId } as unknown as UserRepo,
    findByWorkosUserId,
    orgRepo: { findByWorkosOrgId } as unknown as OrgRepo,
    findByWorkosOrgId,
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
    it("looks up user by workosUserId, resolves WorkOS org id → local UUID, then membership; emits login_success", async () => {
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);
      deps.findByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      deps.findByOrgUser.mockResolvedValue({
        id: "33333333-3333-4333-8333-333333333333",
        orgId: LOCAL_ORG.id,
        userId: ACTIVE_USER.id,
        role: "owner",
        createdAt: NOW,
        updatedAt: NOW,
      });

      const result = await handleLoginCallback(VALID_INPUT, deps);

      expect(deps.findByWorkosUserId).toHaveBeenCalledWith(
        RETURNING_SESSION.user.id,
      );
      // The bug Cursor caught: passing session.organizationId (a
      // WorkOS text id) directly to findByOrgUser would either
      // throw "invalid input syntax for type uuid" in production or
      // silently miss every membership. The fix routes through
      // orgRepo.findByWorkosOrgId first.
      expect(deps.findByWorkosOrgId).toHaveBeenCalledWith(WORKOS_ORG_ID);
      expect(deps.findByOrgUser).toHaveBeenCalledWith(
        LOCAL_ORG.id,
        ACTIVE_USER.id,
      );
      expect(result.user.id).toBe(ACTIVE_USER.id);
      expect(result.membership?.role).toBe("owner");

      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "login_success",
          outcome: "success",
          actorUserId: ACTIVE_USER.id,
          orgId: LOCAL_ORG.id,
        }),
      );
    });

    it("returns null membership when the local org mirror is missing for a known WorkOS org id", async () => {
      // Webhook lag / data inconsistency — the WorkOS session has
      // an org id we don't yet mirror locally. Login still succeeds
      // (the user can see /me); admin tooling surfaces the
      // inconsistency separately.
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);
      deps.findByWorkosOrgId.mockResolvedValue(null);

      const result = await handleLoginCallback(VALID_INPUT, deps);

      expect(deps.findByOrgUser).not.toHaveBeenCalled();
      expect(result.membership).toBeNull();
    });

    it("returns null membership for users with no row in the local org (external)", async () => {
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);
      deps.findByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      deps.findByOrgUser.mockResolvedValue(null);

      const result = await handleLoginCallback(VALID_INPUT, deps);

      expect(result.membership).toBeNull();
    });

    it("preserves the local org id in the login_success audit even when membership is null (external user)", async () => {
      // Pre-fix this audit recorded `orgId: null` because the audit
      // call read `membership?.orgId` rather than the resolved
      // local org. External logins through a known org would have
      // been invisible to per-org audit queries.
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);
      deps.findByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      deps.findByOrgUser.mockResolvedValue(null);

      await handleLoginCallback(VALID_INPUT, deps);

      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "login_success",
          outcome: "success",
          actorUserId: ACTIVE_USER.id,
          orgId: LOCAL_ORG.id,
        }),
      );
    });

    it("skips both org and membership lookups when WorkOS returns no organizationId", async () => {
      deps.authenticateWithCode.mockResolvedValue({
        ...RETURNING_SESSION,
        organizationId: undefined,
      });
      deps.findByWorkosUserId.mockResolvedValue(ACTIVE_USER);

      const result = await handleLoginCallback(VALID_INPUT, deps);

      expect(deps.findByWorkosOrgId).not.toHaveBeenCalled();
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
      deps.findByWorkosOrgId.mockResolvedValue(LOCAL_ORG);
      deps.findByOrgUser.mockResolvedValue(null);
      deps.auditWrite.mockRejectedValue(new Error("audit table down"));
      const result = await handleLoginCallback(VALID_INPUT, deps);
      expect(result.user.id).toBe(ACTIVE_USER.id);
    });
  });
});
