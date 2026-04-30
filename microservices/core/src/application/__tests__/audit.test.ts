// Unit tests for the application-layer audit writer.
//
// Mocks `AuditRepo.write` — what we're testing here is the
// validation + NFR8-stripping behaviour around the persistence call,
// not drizzle. The repo's own integration tests (T-007) cover the
// SQL path.

import { describe, expect, it, vi } from "vitest";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import { recordAuditEvent, type RecordAuditEventInput } from "../audit";

const VALID_INPUT: RecordAuditEventInput = {
  eventType: "login_success",
  outcome: "success",
  actorUserId: "11111111-1111-4111-8111-111111111111",
  targetUserId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  sourceIp: "203.0.113.5",
  userAgent: "test/1.0",
  metadata: { workosSessionId: "sess_abc" },
};

function mockRepo(): { repo: AuditRepo; write: ReturnType<typeof vi.fn> } {
  const write = vi.fn().mockImplementation(async (input) => ({
    id: "00000000-0000-4000-8000-000000000000",
    occurredAt: new Date("2026-04-29T10:00:00Z"),
    ...input,
  }));
  const repo = { write } as unknown as AuditRepo;
  return { repo, write };
}

describe("recordAuditEvent", () => {
  describe("happy path", () => {
    it("validates the input and forwards it to AuditRepo.write", async () => {
      const { repo, write } = mockRepo();
      const event = await recordAuditEvent(VALID_INPUT, { auditRepo: repo });

      expect(write).toHaveBeenCalledOnce();
      expect(event.eventType).toBe("login_success");
      expect(event.outcome).toBe("success");
    });

    it("normalises optional null fields to explicit nulls at the repo boundary", async () => {
      const { repo, write } = mockRepo();
      // Caller omits actorUserId / targetUserId / orgId entirely (they
      // can be undefined in the input). Repo should see explicit nulls
      // — its insert uses `?? null` but we also set them ourselves so
      // the DB column shape is unambiguous.
      await recordAuditEvent(
        {
          eventType: "signup",
          outcome: "success",
          sourceIp: "203.0.113.5",
          userAgent: "test/1.0",
        },
        { auditRepo: repo },
      );

      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: null,
          targetUserId: null,
          orgId: null,
          metadata: {},
        }),
      );
    });
  });

  describe("validation (T-013 DoD: rejects events missing required fields)", () => {
    it("throws when eventType is missing", async () => {
      const { repo } = mockRepo();
      await expect(
        recordAuditEvent(
          // @ts-expect-error — deliberate missing required field
          { outcome: "success", sourceIp: "1.2.3.4", userAgent: "x" },
          { auditRepo: repo },
        ),
      ).rejects.toThrow();
    });

    it("throws when outcome is missing", async () => {
      const { repo } = mockRepo();
      await expect(
        recordAuditEvent(
          // @ts-expect-error — deliberate missing required field
          { eventType: "login_success", sourceIp: "1.2.3.4", userAgent: "x" },
          { auditRepo: repo },
        ),
      ).rejects.toThrow();
    });

    it("throws when sourceIp is missing", async () => {
      const { repo } = mockRepo();
      await expect(
        recordAuditEvent(
          // @ts-expect-error — deliberate missing required field
          { eventType: "logout", outcome: "success", userAgent: "x" },
          { auditRepo: repo },
        ),
      ).rejects.toThrow();
    });

    it("throws when sourceIp is not a valid IP", async () => {
      const { repo } = mockRepo();
      await expect(
        recordAuditEvent(
          { ...VALID_INPUT, sourceIp: "not-an-ip" },
          { auditRepo: repo },
        ),
      ).rejects.toThrow();
    });

    it("throws when eventType is not one of the 21 FR24 values", async () => {
      const { repo } = mockRepo();
      await expect(
        recordAuditEvent(
          // @ts-expect-error — invalid literal at compile time too
          { ...VALID_INPUT, eventType: "user_archived" },
          { auditRepo: repo },
        ),
      ).rejects.toThrow();
    });
  });

  describe("NFR8 (strips forbidden material from metadata)", () => {
    it.each([
      ["password", "hunter2"],
      ["passwordHash", "$2b$..."],
      ["mfaCode", "123456"],
      ["mfa_code", "123456"],
      ["recoveryCode", "ABCD-EFGH-IJKL"],
      ["recovery_code", "ABCD-EFGH-IJKL"],
      ["sessionToken", "sess_abc"],
      ["session_token", "sess_abc"],
      ["resetToken", "tok_abc"],
      ["inviteToken", "tok_abc"],
      ["clientSecret", "sk_..."],
    ])("drops `%s` from metadata", async (key, value) => {
      const { repo, write } = mockRepo();
      await recordAuditEvent(
        { ...VALID_INPUT, metadata: { [key]: value, benign: 42 } },
        { auditRepo: repo },
      );
      const writtenMetadata = write.mock.calls[0]?.[0]?.metadata as Record<
        string,
        unknown
      >;
      expect(writtenMetadata).not.toHaveProperty(key);
      // Benign keys survive — proving the strip is targeted, not a
      // wholesale wipe.
      expect(writtenMetadata.benign).toBe(42);
    });

    it("keeps email even though it's PII (NFR8 explicitly allows it in audit events)", async () => {
      const { repo, write } = mockRepo();
      await recordAuditEvent(
        { ...VALID_INPUT, metadata: { email: "alice@example.com" } },
        { auditRepo: repo },
      );
      const writtenMetadata = write.mock.calls[0]?.[0]?.metadata as Record<
        string,
        unknown
      >;
      expect(writtenMetadata.email).toBe("alice@example.com");
    });

    it("default-empty metadata round-trips as `{}` to the repo", async () => {
      const { repo, write } = mockRepo();
      await recordAuditEvent(
        {
          eventType: "logout",
          outcome: "success",
          sourceIp: "203.0.113.5",
          userAgent: "test/1.0",
        },
        { auditRepo: repo },
      );
      expect(write.mock.calls[0]?.[0]?.metadata).toEqual({});
    });
  });
});
