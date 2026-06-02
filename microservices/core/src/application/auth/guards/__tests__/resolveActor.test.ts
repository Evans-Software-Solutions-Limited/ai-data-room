// Unit tests for `resolveActor`. The guard is a pure function with
// dep-injected repos, so no SST / SDK module mocks are needed —
// just `vi.fn()`-backed `UserRepo` / `OrgRepo` doubles.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../../../infrastructure/logging/logger";
import { resolveActor } from "../resolveActor";
import type { MembershipRepo } from "../../../../infrastructure/db/membershipRepo";
import type { OrgRepo } from "../../../../infrastructure/db/orgRepo";
import type { UserRepo } from "../../../../infrastructure/db/userRepo";

const WORKOS_USER_ID = "user_workos_xyz";
const WORKOS_ORG_ID = "org_workos_abc";
const LOCAL_USER_ID = "11111111-1111-4111-8111-111111111111";
const LOCAL_ORG_ID = "22222222-2222-4222-8222-222222222222";

const WORKOS_USER = {
  object: "user" as const,
  id: WORKOS_USER_ID,
  email: "alice@example.com",
  firstName: "Alice",
  lastName: "Example",
  emailVerified: true,
  profilePictureUrl: null,
  lastSignInAt: null,
  locale: null,
  externalId: null,
  metadata: {},
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const LOCAL_USER = {
  id: LOCAL_USER_ID,
  workosUserId: WORKOS_USER_ID,
  email: "alice@example.com",
  fullName: "Alice Example",
  lifecycleState: "active" as const,
  emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  mfaEnrolledAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const LOCAL_ORG = {
  id: LOCAL_ORG_ID,
  workosOrgId: WORKOS_ORG_ID,
  name: "ACME Corp",
  slug: "acme-corp",
  status: "active" as const,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

interface Repos {
  userRepo: UserRepo;
  orgRepo: OrgRepo;
  membershipRepo: MembershipRepo;
  findByWorkosUserId: ReturnType<typeof vi.fn>;
  userCreate: ReturnType<typeof vi.fn>;
  findByWorkosOrgId: ReturnType<typeof vi.fn>;
  membershipFindByUser: ReturnType<typeof vi.fn>;
}

function makeRepos(): Repos {
  const findByWorkosUserId = vi.fn();
  const userCreate = vi.fn();
  const userRepo = {
    findByWorkosUserId,
    create: userCreate,
  } as unknown as UserRepo;

  const findByWorkosOrgId = vi.fn();
  const orgRepo = { findByWorkosOrgId } as unknown as OrgRepo;

  // Defaults to "no membership" so the session-org path is exercised
  // unchanged; the org-provisioning fallback tests override it.
  const membershipFindByUser = vi.fn().mockResolvedValue(null);
  const membershipRepo = {
    findByUser: membershipFindByUser,
  } as unknown as MembershipRepo;

  return {
    userRepo,
    orgRepo,
    membershipRepo,
    findByWorkosUserId,
    userCreate,
    findByWorkosOrgId,
    membershipFindByUser,
  };
}

describe("resolveActor", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("happy path — both user and org already mirrored", () => {
    it("translates WorkOS IDs to local UUIDs without lazy-creating", async () => {
      const repos = makeRepos();
      repos.findByWorkosUserId.mockResolvedValue(LOCAL_USER);
      repos.findByWorkosOrgId.mockResolvedValue(LOCAL_ORG);

      const result = await resolveActor(
        { user: WORKOS_USER, organizationId: WORKOS_ORG_ID },
        repos,
      );

      expect(result).toEqual({
        actor: {
          localUserId: LOCAL_USER_ID,
          localOrgId: LOCAL_ORG_ID,
        },
      });
      expect(repos.userCreate).not.toHaveBeenCalled();
    });
  });

  describe("membership fallback — org-provisioning (slice 17)", () => {
    const MEMBERSHIP = {
      id: "99999999-9999-4999-8999-999999999999",
      orgId: LOCAL_ORG_ID,
      userId: LOCAL_USER_ID,
      role: "owner" as const,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };

    it("resolves localOrgId from the membership when the session has no org", async () => {
      // A user who just created an org via POST /orgs: session still
      // predates the org (organizationId null) but a membership exists.
      const repos = makeRepos();
      repos.findByWorkosUserId.mockResolvedValue(LOCAL_USER);
      repos.membershipFindByUser.mockResolvedValue(MEMBERSHIP);

      const result = await resolveActor(
        { user: WORKOS_USER, organizationId: null },
        repos,
      );

      expect(result.actor.localOrgId).toBe(LOCAL_ORG_ID);
      expect(repos.findByWorkosOrgId).not.toHaveBeenCalled();
    });

    it("prefers the session org and skips the membership lookup when both exist", async () => {
      const repos = makeRepos();
      repos.findByWorkosUserId.mockResolvedValue(LOCAL_USER);
      repos.findByWorkosOrgId.mockResolvedValue(LOCAL_ORG);

      const result = await resolveActor(
        { user: WORKOS_USER, organizationId: WORKOS_ORG_ID },
        repos,
      );

      expect(result.actor.localOrgId).toBe(LOCAL_ORG_ID);
      expect(repos.membershipFindByUser).not.toHaveBeenCalled();
    });
  });

  describe("lazy-mirror path — fresh organic signup", () => {
    it("creates the user mirror with mfa+email-verified stamps when WorkOS says verified", async () => {
      const repos = makeRepos();
      repos.findByWorkosUserId.mockResolvedValue(null);
      repos.userCreate.mockResolvedValue(LOCAL_USER);
      repos.findByWorkosOrgId.mockResolvedValue(null);

      const result = await resolveActor(
        { user: WORKOS_USER, organizationId: null },
        repos,
      );

      expect(repos.userCreate).toHaveBeenCalledWith({
        workosUserId: WORKOS_USER_ID,
        email: "alice@example.com",
        fullName: "Alice Example",
        mfaEnrolledAt: expect.any(Date),
        emailVerifiedAt: expect.any(Date),
      });
      expect(result.actor.localUserId).toBe(LOCAL_USER_ID);
      expect(result.actor.localOrgId).toBeNull();
    });

    it("leaves emailVerifiedAt null when WorkOS says NOT verified", async () => {
      const repos = makeRepos();
      repos.findByWorkosUserId.mockResolvedValue(null);
      repos.userCreate.mockResolvedValue({
        ...LOCAL_USER,
        emailVerifiedAt: null,
      });

      await resolveActor(
        {
          user: { ...WORKOS_USER, emailVerified: false },
          organizationId: null,
        },
        repos,
      );

      expect(repos.userCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerifiedAt: null,
          // mfa stays stamped — AuthKit gates signup on enrolment
          // regardless of email-verified state.
          mfaEnrolledAt: expect.any(Date),
        }),
      );
    });

    it.each([
      { firstName: null, lastName: null, expected: null },
      { firstName: "Alice", lastName: null, expected: "Alice" },
      { firstName: null, lastName: "Example", expected: "Example" },
      { firstName: "  ", lastName: "Example", expected: "Example" },
      {
        firstName: "Alice",
        lastName: "  Example  ",
        expected: "Alice Example",
      },
    ])(
      "composes fullName from first+last (firstName=$firstName lastName=$lastName)",
      async ({ firstName, lastName, expected }) => {
        const repos = makeRepos();
        repos.findByWorkosUserId.mockResolvedValue(null);
        repos.userCreate.mockResolvedValue(LOCAL_USER);

        await resolveActor(
          {
            user: { ...WORKOS_USER, firstName, lastName },
            organizationId: null,
          },
          repos,
        );

        expect(repos.userCreate).toHaveBeenCalledWith(
          expect.objectContaining({ fullName: expected }),
        );
      },
    );

    it("recovers from a unique-violation race by re-finding the existing row", async () => {
      const repos = makeRepos();
      // First find: miss. Lazy-create throws (concurrent insert
      // landed first). Second find: row is now there.
      repos.findByWorkosUserId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(LOCAL_USER);
      repos.userCreate.mockRejectedValue(new Error("unique violation"));

      const result = await resolveActor(
        { user: WORKOS_USER, organizationId: null },
        repos,
      );

      expect(repos.findByWorkosUserId).toHaveBeenCalledTimes(2);
      expect(result.actor.localUserId).toBe(LOCAL_USER_ID);
    });

    it("throws when create fails AND the re-find also misses (real bug, not a race)", async () => {
      const repos = makeRepos();
      const originalErr = new Error("connection refused");
      repos.findByWorkosUserId.mockResolvedValue(null);
      repos.userCreate.mockRejectedValue(originalErr);

      // The wrapper's message + the original error preserved as
      // `cause` — both checked, because losing `cause` would silently
      // strip the diagnostic context CloudWatch needs to triage a
      // real DB outage.
      await expect(
        resolveActor({ user: WORKOS_USER, organizationId: null }, repos),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/lazy-mirror failed/),
        cause: originalErr,
      });
    });
  });

  describe("org resolution", () => {
    it("returns localOrgId=null when the WorkOS session has no organizationId", async () => {
      const repos = makeRepos();
      repos.findByWorkosUserId.mockResolvedValue(LOCAL_USER);

      const result = await resolveActor(
        { user: WORKOS_USER, organizationId: null },
        repos,
      );

      expect(repos.findByWorkosOrgId).not.toHaveBeenCalled();
      expect(result.actor.localOrgId).toBeNull();
    });

    it("returns localOrgId=null when the WorkOS session has organizationId=undefined (legacy SDK shape)", async () => {
      const repos = makeRepos();
      repos.findByWorkosUserId.mockResolvedValue(LOCAL_USER);

      const result = await resolveActor(
        { user: WORKOS_USER, organizationId: undefined },
        repos,
      );

      expect(repos.findByWorkosOrgId).not.toHaveBeenCalled();
      expect(result.actor.localOrgId).toBeNull();
    });

    it("graceful-degrades to localOrgId=null when WorkOS asserts an org but the local mirror is missing", async () => {
      const repos = makeRepos();
      repos.findByWorkosUserId.mockResolvedValue(LOCAL_USER);
      repos.findByWorkosOrgId.mockResolvedValue(null);

      const result = await resolveActor(
        { user: WORKOS_USER, organizationId: WORKOS_ORG_ID },
        repos,
      );

      expect(result.actor.localOrgId).toBeNull();
      // Logged so the breadcrumb is visible in CloudWatch — slice 18
      // observability will surface this as a metric if it ever fires
      // in production volume.
      expect(warnSpy).toHaveBeenCalledWith(
        "resolveActor.workos_org_without_local_mirror",
        expect.objectContaining({
          workosUserId: WORKOS_USER_ID,
          workosOrgId: WORKOS_ORG_ID,
        }),
      );
    });
  });
});
