// Unit tests for `handleUserDeleted`.
//
// Mocks `UserRepo` + a real `recordAuditEvent` against a mocked
// `AuditRepo` — same pattern as `password-reset.test.ts` /
// `mfa.test.ts`. NFR9's "audit continuity" half is verified at the
// integration layer (`userRepo.integration.test.ts`'s `scrubPii`
// joins-still-resolve case); these unit tests pin the application-
// layer contract: idempotency, audit-shape, and PII non-leakage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { UserRepo } from "../../infrastructure/db/userRepo";
import type { User } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { handleUserDeleted } from "../deletion";

const NOW = new Date("2026-05-04T12:00:00Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKOS_USER_ID = "user_workos_target";
const ACTIVE_EMAIL = "deleteme@example.com";
const ACTIVE_NAME = "Delete Me";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    workosUserId: WORKOS_USER_ID,
    email: ACTIVE_EMAIL,
    fullName: ACTIVE_NAME,
    lifecycleState: "active",
    emailVerifiedAt: NOW,
    mfaEnrolledAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTombstone(): User {
  return makeUser({
    email: null,
    fullName: null,
    lifecycleState: "deleted",
  });
}

interface MockDeps {
  userRepo: UserRepo;
  findByWorkosUserId: ReturnType<typeof vi.fn>;
  scrubPii: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const findByWorkosUserId = vi.fn();
  const scrubPii = vi.fn();
  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  return {
    userRepo: {
      findByWorkosUserId,
      scrubPii,
    } as unknown as UserRepo,
    findByWorkosUserId,
    scrubPii,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

const AUDIT_CTX = { sourceIp: "203.0.113.5", userAgent: "test/1.0" } as const;

describe("handleUserDeleted", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("happy path (NFR9)", () => {
    it("scrubs PII, audits user_deleted with the local UUID as targetUserId, returns the tombstone", async () => {
      deps.findByWorkosUserId.mockResolvedValue(makeUser());
      deps.scrubPii.mockResolvedValue(makeTombstone());

      const result = await handleUserDeleted(
        { workosUserId: WORKOS_USER_ID, audit: AUDIT_CTX },
        deps,
      );

      expect(deps.scrubPii).toHaveBeenCalledWith(USER_ID);
      expect(result.user?.id).toBe(USER_ID);
      expect(result.user?.lifecycleState).toBe("deleted");
      expect(result.user?.email).toBeNull();
      expect(result.user?.fullName).toBeNull();
      // workosUserId tombstone retained — load-bearing for the
      // FR21(c) "future login attempts" reject path AND for any
      // future webhook redelivery to resolve back to the same row.
      expect(result.user?.workosUserId).toBe(WORKOS_USER_ID);

      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "user_deleted",
          outcome: "success",
          targetUserId: USER_ID,
          metadata: expect.objectContaining({
            workosUserId: WORKOS_USER_ID,
          }),
        }),
      );
    });

    it("does NOT echo the scrubbed PII back through the audit metadata", async () => {
      // Defends NFR9 (and NFR8 by extension): the whole point of
      // scrubbing is that email + fullName disappear from the
      // system. If the audit row carried them in metadata, we'd
      // have re-leaked exactly what we just deleted. Closed-shape
      // assertion catches a future regression where someone adds
      // `email: user.email` "for context".
      deps.findByWorkosUserId.mockResolvedValue(makeUser());
      deps.scrubPii.mockResolvedValue(makeTombstone());

      await handleUserDeleted(
        { workosUserId: WORKOS_USER_ID, audit: AUDIT_CTX },
        deps,
      );

      const [auditEvent] = deps.auditWrite.mock.calls[0]!;
      // Closed-shape `toEqual` already proves no other keys exist —
      // including any future regression that adds `email` /
      // `fullName` "for context". A separate `JSON.stringify`
      // not-contain check would be redundant.
      expect(auditEvent.metadata).toEqual({ workosUserId: WORKOS_USER_ID });
    });
  });

  describe("webhook idempotency", () => {
    it("returns null + audits failure when the WorkOS user is unknown", async () => {
      deps.findByWorkosUserId.mockResolvedValue(null);

      const result = await handleUserDeleted(
        { workosUserId: "user_unmirrored", audit: AUDIT_CTX },
        deps,
      );

      expect(result).toEqual({ user: null });
      expect(deps.scrubPii).not.toHaveBeenCalled();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "user_deleted",
          outcome: "failure",
          metadata: expect.objectContaining({
            reason: "user_not_found",
            workosUserId: "user_unmirrored",
          }),
        }),
      );
    });

    it("no-ops on redelivery for an already-deleted tombstone", async () => {
      // Webhook redelivery hits the existing tombstone row. We
      // must NOT re-scrub (no-op anyway, but we'd waste a write
      // and emit a misleading success audit) and we must NOT
      // throw (would force WorkOS into a permanent retry).
      deps.findByWorkosUserId.mockResolvedValue(makeTombstone());

      const result = await handleUserDeleted(
        { workosUserId: WORKOS_USER_ID, audit: AUDIT_CTX },
        deps,
      );

      expect(deps.scrubPii).not.toHaveBeenCalled();
      expect(result.user?.lifecycleState).toBe("deleted");
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "user_deleted",
          outcome: "failure",
          targetUserId: USER_ID,
          metadata: expect.objectContaining({
            reason: "already_deleted",
            workosUserId: WORKOS_USER_ID,
          }),
        }),
      );
      // No success audit on the redelivery path.
      const successCalls = deps.auditWrite.mock.calls.filter(
        ([event]) => event.outcome === "success",
      );
      expect(successCalls).toHaveLength(0);
    });
  });
});
