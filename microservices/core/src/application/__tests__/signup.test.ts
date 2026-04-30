// Unit tests for the signup-callback application function.
//
// Mocks the WorkOSClient surface (we own the interface, T-006) and
// each repo (T-007 — class-shaped DI). The audit writer goes through
// the real `recordAuditEvent` against a mocked AuditRepo so we
// exercise both the validation path and the NFR8-stripping path
// every flow now depends on (T-013).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AuthenticationResponse,
  WorkOSClient,
} from "../../infrastructure/workos/client";
import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { MembershipRepo } from "../../infrastructure/db/membershipRepo";
import type { OrgRepo } from "../../infrastructure/db/orgRepo";
import type { UserRepo } from "../../infrastructure/db/userRepo";

import { handleSignup, SignupError } from "../signup";

const NOW = new Date("2026-04-30T10:00:00Z");

const FRESH_USER: AuthenticationResponse["user"] = {
  object: "user",
  id: "user_workos_signup",
  email: "alice@example.com",
  emailVerified: true,
  profilePictureUrl: null,
  firstName: "Alice",
  lastName: "Example",
  lastSignInAt: null,
  locale: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  externalId: null,
  metadata: {},
};

const FRESH_SESSION: AuthenticationResponse = {
  user: FRESH_USER,
  organizationId: "org_workos_signup",
  accessToken: "at_test",
  refreshToken: "rt_test",
};

const VALID_INPUT = {
  workosCode: "code_test",
  workosClientId: "client_test_id",
  orgName: "Capital Pay",
  orgSlug: "capital-pay",
  audit: { sourceIp: "203.0.113.5", userAgent: "test/1.0" } as const,
};

interface MockDeps {
  workos: WorkOSClient;
  authenticateWithCode: ReturnType<typeof vi.fn>;
  userRepo: UserRepo;
  userCreate: ReturnType<typeof vi.fn>;
  orgRepo: OrgRepo;
  orgCreate: ReturnType<typeof vi.fn>;
  membershipRepo: MembershipRepo;
  membershipCreate: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const authenticateWithCode = vi.fn();
  const userCreate = vi.fn();
  const orgCreate = vi.fn();
  const membershipCreate = vi.fn();
  const auditWrite = vi.fn().mockResolvedValue({
    id: "audit_id",
    occurredAt: NOW,
  });

  return {
    workos: { authenticateWithCode } as unknown as WorkOSClient,
    authenticateWithCode,
    userRepo: { create: userCreate } as unknown as UserRepo,
    userCreate,
    orgRepo: { create: orgCreate } as unknown as OrgRepo,
    orgCreate,
    membershipRepo: { create: membershipCreate } as unknown as MembershipRepo,
    membershipCreate,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

describe("handleSignup", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
    deps.authenticateWithCode.mockResolvedValue(FRESH_SESSION);
    deps.userCreate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      workosUserId: FRESH_USER.id,
      email: FRESH_USER.email,
      fullName: "Alice Example",
      lifecycleState: "active",
      emailVerifiedAt: null,
      mfaEnrolledAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    deps.orgCreate.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      workosOrgId: FRESH_SESSION.organizationId!,
      name: VALID_INPUT.orgName,
      slug: VALID_INPUT.orgSlug,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    deps.membershipCreate.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      orgId: "22222222-2222-4222-8222-222222222222",
      userId: "11111111-1111-4111-8111-111111111111",
      role: "owner",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path (US1 — fresh signup)", () => {
    it("creates user, org, owner membership and emits a signup audit", async () => {
      const result = await handleSignup(VALID_INPUT, deps);

      expect(deps.authenticateWithCode).toHaveBeenCalledWith({
        code: "code_test",
        clientId: "client_test_id",
      });
      expect(deps.userCreate).toHaveBeenCalledWith({
        workosUserId: FRESH_USER.id,
        email: FRESH_USER.email,
        fullName: "Alice Example",
      });
      expect(deps.orgCreate).toHaveBeenCalledWith({
        workosOrgId: FRESH_SESSION.organizationId,
        name: "Capital Pay",
        slug: "capital-pay",
      });
      expect(deps.membershipCreate).toHaveBeenCalledWith({
        orgId: result.org.id,
        userId: result.user.id,
        role: "owner",
      });

      const auditCall = deps.auditWrite.mock.calls[0]?.[0];
      expect(auditCall).toMatchObject({
        eventType: "signup",
        outcome: "success",
        actorUserId: result.user.id,
        targetUserId: result.user.id,
        orgId: result.org.id,
      });
    });

    it("synthesises workosOrgId for solo signups when AuthKit returns no organizationId", async () => {
      deps.authenticateWithCode.mockResolvedValue({
        ...FRESH_SESSION,
        organizationId: undefined,
      });
      await handleSignup(VALID_INPUT, deps);
      // The synthetic ID is `synth_<uuid>`, not `synth_<workos user id>`,
      // so a re-signup for the same WorkOS user (after a delete + re-
      // signup) doesn't collide on the unique index.
      expect(deps.orgCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          workosOrgId: expect.stringMatching(
            /^synth_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
          ),
        }),
      );
    });

    it("generates a fresh synthetic workosOrgId on each call", async () => {
      // Defends the collision-on-resignup invariant: two back-to-back
      // signup calls with the same WorkOS user id (which can happen
      // after delete-then-resignup) must mint distinct workosOrgIds.
      deps.authenticateWithCode.mockResolvedValue({
        ...FRESH_SESSION,
        organizationId: undefined,
      });
      await handleSignup(VALID_INPUT, deps);
      await handleSignup(VALID_INPUT, deps);
      const idA = deps.orgCreate.mock.calls[0]?.[0]?.workosOrgId;
      const idB = deps.orgCreate.mock.calls[1]?.[0]?.workosOrgId;
      expect(idA).not.toBe(idB);
    });

    it("composes fullName from WorkOS firstName + lastName", async () => {
      deps.authenticateWithCode.mockResolvedValue({
        ...FRESH_SESSION,
        user: { ...FRESH_USER, firstName: "Alice", lastName: null },
      });
      await handleSignup(VALID_INPUT, deps);
      expect(deps.userCreate).toHaveBeenCalledWith(
        expect.objectContaining({ fullName: "Alice" }),
      );
    });

    it("returns null fullName when WorkOS provides neither name part", async () => {
      deps.authenticateWithCode.mockResolvedValue({
        ...FRESH_SESSION,
        user: { ...FRESH_USER, firstName: null, lastName: null },
      });
      await handleSignup(VALID_INPUT, deps);
      expect(deps.userCreate).toHaveBeenCalledWith(
        expect.objectContaining({ fullName: null }),
      );
    });
  });

  describe("FR16 / US4 — MFA-missing rejection", () => {
    it("throws SignupError('mfa_required') when the MFA predicate returns false", async () => {
      await expect(
        handleSignup(VALID_INPUT, {
          ...deps,
          isMfaPresent: () => false,
        }),
      ).rejects.toThrow(SignupError);
    });

    it("emits a signup audit with outcome=failure and reason=mfa_required", async () => {
      await handleSignup(VALID_INPUT, {
        ...deps,
        isMfaPresent: () => false,
      }).catch(() => {});

      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "signup",
          outcome: "failure",
          metadata: expect.objectContaining({ reason: "mfa_required" }),
        }),
      );
    });

    it("does not create user / org / membership when MFA is missing", async () => {
      await handleSignup(VALID_INPUT, {
        ...deps,
        isMfaPresent: () => false,
      }).catch(() => {});

      expect(deps.userCreate).not.toHaveBeenCalled();
      expect(deps.orgCreate).not.toHaveBeenCalled();
      expect(deps.membershipCreate).not.toHaveBeenCalled();
    });
  });

  describe("audit-write failure does not mask the success path", () => {
    it("returns the signup result even if recordAuditEvent throws", async () => {
      deps.auditWrite.mockRejectedValue(new Error("audit table down"));
      const result = await handleSignup(VALID_INPUT, deps);
      expect(result.user.workosUserId).toBe(FRESH_USER.id);
      expect(result.org.slug).toBe("capital-pay");
    });
  });
});
