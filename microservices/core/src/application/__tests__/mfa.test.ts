// Unit tests for `handleMfaEnrolled` / `handleRecoveryCodeUsed`.
//
// Mocks `UserRepo`; real `recordAuditEvent` against a mocked
// `AuditRepo` — same pattern as `password-reset.test.ts` /
// `suspension.test.ts`. We exercise the validation +
// NFR8-stripping pipeline that every audit-emitting flow goes
// through.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { UserRepo } from "../../infrastructure/db/userRepo";
import type { User } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { handleMfaEnrolled, handleRecoveryCodeUsed } from "../mfa";

const NOW = new Date("2026-05-03T10:00:00Z");
const ENROLLED_AT = new Date("2026-05-03T09:55:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKOS_USER_ID = "user_workos_target";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    workosUserId: WORKOS_USER_ID,
    email: "user@example.com",
    fullName: "Target User",
    lifecycleState: "active",
    emailVerifiedAt: NOW,
    mfaEnrolledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

interface MockDeps {
  userRepo: UserRepo;
  findByWorkosUserId: ReturnType<typeof vi.fn>;
  setMfaEnrolledAt: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const findByWorkosUserId = vi.fn();
  const setMfaEnrolledAt = vi.fn();
  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  return {
    userRepo: {
      findByWorkosUserId,
      setMfaEnrolledAt,
    } as unknown as UserRepo,
    findByWorkosUserId,
    setMfaEnrolledAt,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

const AUDIT_CTX = { sourceIp: "203.0.113.5", userAgent: "test/1.0" } as const;

describe("handleMfaEnrolled", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mirrors mfa_enrolled_at and audits success on the happy path", async () => {
    deps.findByWorkosUserId.mockResolvedValue(makeUser());
    deps.setMfaEnrolledAt.mockResolvedValue(
      makeUser({ mfaEnrolledAt: ENROLLED_AT }),
    );

    const result = await handleMfaEnrolled(
      {
        workosUserId: WORKOS_USER_ID,
        enrolledAt: ENROLLED_AT,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(deps.setMfaEnrolledAt).toHaveBeenCalledWith(USER_ID, ENROLLED_AT);
    expect(result.user?.mfaEnrolledAt).toEqual(ENROLLED_AT);
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mfa_enrolled",
        outcome: "success",
        targetUserId: USER_ID,
        metadata: { enrolledAt: ENROLLED_AT.toISOString() },
      }),
    );
  });

  it("returns null + audits failure when the user is not mirrored locally", async () => {
    deps.findByWorkosUserId.mockResolvedValue(null);

    const result = await handleMfaEnrolled(
      {
        workosUserId: "user_unmirrored",
        enrolledAt: ENROLLED_AT,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(result).toEqual({ user: null });
    expect(deps.setMfaEnrolledAt).not.toHaveBeenCalled();
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "mfa_enrolled",
        outcome: "failure",
        metadata: expect.objectContaining({
          reason: "user_not_found",
          workosUserId: "user_unmirrored",
        }),
      }),
    );
  });
});

describe("handleRecoveryCodeUsed", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("audits success without writing any user state", async () => {
    deps.findByWorkosUserId.mockResolvedValue(makeUser());

    const result = await handleRecoveryCodeUsed(
      { workosUserId: WORKOS_USER_ID, audit: AUDIT_CTX },
      deps,
    );

    expect(result.user?.id).toBe(USER_ID);
    expect(deps.setMfaEnrolledAt).not.toHaveBeenCalled();
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "recovery_code_used",
        outcome: "success",
        targetUserId: USER_ID,
        metadata: {},
      }),
    );
  });

  it("audit metadata is empty — no per-code identifier ever leaks", async () => {
    // Closed-shape assertion: ADR-003 follow-up #4 commits us to
    // never recording which code was used (we don't see them). Any
    // future regression that adds an `id` / `codeHash` / `code` field
    // breaks this test on purpose. The NFR8 strip in `audit.ts`
    // would catch the literal `recovery_code` keyword anyway, but
    // pinning the shape here is the early-warning system.
    deps.findByWorkosUserId.mockResolvedValue(makeUser());

    await handleRecoveryCodeUsed(
      { workosUserId: WORKOS_USER_ID, audit: AUDIT_CTX },
      deps,
    );

    const [auditEvent] = deps.auditWrite.mock.calls[0]!;
    expect(auditEvent.metadata).toEqual({});
  });

  it("returns null + audits failure when the user is not mirrored locally", async () => {
    deps.findByWorkosUserId.mockResolvedValue(null);

    const result = await handleRecoveryCodeUsed(
      { workosUserId: "user_unmirrored", audit: AUDIT_CTX },
      deps,
    );

    expect(result).toEqual({ user: null });
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "recovery_code_used",
        outcome: "failure",
        metadata: expect.objectContaining({
          reason: "user_not_found",
          workosUserId: "user_unmirrored",
        }),
      }),
    );
  });
});
