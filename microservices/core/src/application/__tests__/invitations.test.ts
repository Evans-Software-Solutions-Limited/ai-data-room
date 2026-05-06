// Unit tests for the invitation lifecycle functions.
//
// Mocks `WorkOSClient` + each repo via `vi.fn()`; real
// `recordAuditEvent` against a mocked `AuditRepo` — same pattern as
// `signup.test.ts` / `password-reset.test.ts`. The `acceptInvitation`
// tests additionally exercise the `db.transaction` mock shape from
// the txn-wrapper PR so we can assert atomic multi-write behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Invitation as WorkOSInvitation,
  WorkOSClient,
} from "../../infrastructure/workos/client";
import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { ExternalGrantRepo } from "../../infrastructure/db/externalGrantRepo";
import type { InvitationRepo } from "../../infrastructure/db/invitationRepo";
import type { MembershipRepo } from "../../infrastructure/db/membershipRepo";
import type { OrgRepo } from "../../infrastructure/db/orgRepo";
import type { UserRepo } from "../../infrastructure/db/userRepo";
import type { Db } from "@ai-data-room/db";
import type {
  ExternalAccessGrant,
  Invitation,
  Org,
  OrgMembership,
  User,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import {
  acceptInvitation,
  createInvitation,
  InvitationError,
  listInvitations,
  revokeInvitation,
} from "../invitations";

const NOW = new Date("2026-05-04T10:00:00Z");
const EXPIRES_AT_ISO = "2026-05-11T10:00:00Z";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_WORKOS_ID = "user_workos_actor";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ORG_WORKOS_ID = "org_workos_target";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const WORKOS_INVITATION_ID = "invitation_workos_target";
const ACCEPTING_USER_ID = "44444444-4444-4444-8444-444444444444";
const ACCEPTING_WORKOS_USER_ID = "user_workos_invitee";
const AUDIT_CTX = {
  sourceIp: "203.0.113.5",
  userAgent: "test/1.0",
} as const;

const TX_SENTINEL = Symbol("tx");

// ─── Fixture helpers ──────────────────────────────────────────────────

function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: INVITATION_ID,
    workosInvitationId: WORKOS_INVITATION_ID,
    orgId: ORG_ID,
    email: "invitee@example.com",
    kind: "internal",
    role: "internal",
    opportunitySlug: null,
    invitedBy: ACTOR_ID,
    state: "pending",
    expiresAt: new Date(EXPIRES_AT_ISO),
    acceptedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeWorkosInvitation(): WorkOSInvitation {
  return {
    object: "invitation",
    id: WORKOS_INVITATION_ID,
    email: "invitee@example.com",
    state: "pending",
    acceptedAt: null,
    revokedAt: null,
    expiresAt: EXPIRES_AT_ISO,
    organizationId: ORG_WORKOS_ID,
    inviterUserId: ACTOR_WORKOS_ID,
    acceptedUserId: null,
    token: "wo_invite_token_redacted",
    acceptInvitationUrl: "https://authkit.example.com/accept",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: ACTOR_ID,
    workosUserId: ACTOR_WORKOS_ID,
    email: "actor@example.com",
    fullName: "Actor Person",
    lifecycleState: "active",
    emailVerifiedAt: NOW,
    mfaEnrolledAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeOrg(overrides: Partial<Org> = {}): Org {
  return {
    id: ORG_ID,
    workosOrgId: ORG_WORKOS_ID,
    name: "Capital Pay",
    slug: "capital-pay",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

interface MockDeps {
  workos: WorkOSClient;
  createInvitation: ReturnType<typeof vi.fn>;
  revokeInvitation: ReturnType<typeof vi.fn>;
  db: Db;
  dbTransaction: ReturnType<typeof vi.fn>;
  userRepo: UserRepo;
  userFindById: ReturnType<typeof vi.fn>;
  userFindByWorkosUserId: ReturnType<typeof vi.fn>;
  userCreate: ReturnType<typeof vi.fn>;
  userWithTx: ReturnType<typeof vi.fn>;
  orgRepo: OrgRepo;
  orgFindById: ReturnType<typeof vi.fn>;
  invitationRepo: InvitationRepo;
  invitationCreate: ReturnType<typeof vi.fn>;
  invitationFindById: ReturnType<typeof vi.fn>;
  invitationFindByWorkosInvitationId: ReturnType<typeof vi.fn>;
  invitationListByOrgAndState: ReturnType<typeof vi.fn>;
  invitationSetState: ReturnType<typeof vi.fn>;
  invitationTransitionState: ReturnType<typeof vi.fn>;
  invitationWithTx: ReturnType<typeof vi.fn>;
  membershipRepo: MembershipRepo;
  membershipCreate: ReturnType<typeof vi.fn>;
  membershipWithTx: ReturnType<typeof vi.fn>;
  externalGrantRepo: ExternalGrantRepo;
  externalGrantCreate: ReturnType<typeof vi.fn>;
  externalGrantWithTx: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const wsCreateInvitation = vi.fn();
  const wsRevokeInvitation = vi.fn().mockResolvedValue(undefined);

  const userFindById = vi.fn();
  const userFindByWorkosUserId = vi.fn();
  const userCreate = vi.fn();
  const userWithTx = vi.fn();
  const userRepo = {
    findById: userFindById,
    findByWorkosUserId: userFindByWorkosUserId,
    create: userCreate,
    withTx: userWithTx,
  } as unknown as UserRepo;
  userWithTx.mockReturnValue(userRepo);

  const orgFindById = vi.fn();
  const orgRepo = { findById: orgFindById } as unknown as OrgRepo;

  const invitationCreate = vi.fn();
  const invitationFindById = vi.fn();
  const invitationFindByWorkosInvitationId = vi.fn();
  const invitationListByOrgAndState = vi.fn();
  const invitationSetState = vi.fn();
  const invitationTransitionState = vi.fn();
  const invitationWithTx = vi.fn();
  const invitationRepo = {
    create: invitationCreate,
    findById: invitationFindById,
    findByWorkosInvitationId: invitationFindByWorkosInvitationId,
    listByOrgAndState: invitationListByOrgAndState,
    setState: invitationSetState,
    transitionState: invitationTransitionState,
    withTx: invitationWithTx,
  } as unknown as InvitationRepo;
  invitationWithTx.mockReturnValue(invitationRepo);

  const membershipCreate = vi.fn();
  const membershipWithTx = vi.fn();
  const membershipRepo = {
    create: membershipCreate,
    withTx: membershipWithTx,
  } as unknown as MembershipRepo;
  membershipWithTx.mockReturnValue(membershipRepo);

  const externalGrantCreate = vi.fn();
  const externalGrantWithTx = vi.fn();
  const externalGrantRepo = {
    create: externalGrantCreate,
    withTx: externalGrantWithTx,
  } as unknown as ExternalGrantRepo;
  externalGrantWithTx.mockReturnValue(externalGrantRepo);

  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  const dbTransaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb(TX_SENTINEL),
  );

  return {
    workos: {
      createInvitation: wsCreateInvitation,
      revokeInvitation: wsRevokeInvitation,
    } as unknown as WorkOSClient,
    createInvitation: wsCreateInvitation,
    revokeInvitation: wsRevokeInvitation,
    db: { transaction: dbTransaction } as unknown as Db,
    dbTransaction,
    userRepo,
    userFindById,
    userFindByWorkosUserId,
    userCreate,
    userWithTx,
    orgRepo,
    orgFindById,
    invitationRepo,
    invitationCreate,
    invitationFindById,
    invitationFindByWorkosInvitationId,
    invitationListByOrgAndState,
    invitationSetState,
    invitationTransitionState,
    invitationWithTx,
    membershipRepo,
    membershipCreate,
    membershipWithTx,
    externalGrantRepo,
    externalGrantCreate,
    externalGrantWithTx,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

// ─── createInvitation ────────────────────────────────────────────────

describe("createInvitation", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
    deps.userFindById.mockResolvedValue(makeUser());
    deps.orgFindById.mockResolvedValue(makeOrg());
    deps.createInvitation.mockResolvedValue(makeWorkosInvitation());
    deps.invitationCreate.mockResolvedValue(makeInvitation());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("authorization (FR6 / FR7)", () => {
    it("rejects an internal-role actor with actor_role_insufficient", async () => {
      await expect(
        createInvitation(
          {
            kind: "internal",
            role: "internal",
            email: "invitee@example.com",
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "internal",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(InvitationError);

      expect(deps.createInvitation).not.toHaveBeenCalled();
      expect(deps.invitationCreate).not.toHaveBeenCalled();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "invite_sent",
          outcome: "failure",
          metadata: expect.objectContaining({
            reason: "actor_role_insufficient",
          }),
        }),
      );
    });

    it("rejects an admin attempting to invite another admin (only owner can invite admin)", async () => {
      await expect(
        createInvitation(
          {
            kind: "internal",
            role: "admin",
            email: "newadmin@example.com",
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "admin",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(/only_owner_can_invite_admin/);

      expect(deps.createInvitation).not.toHaveBeenCalled();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            reason: "only_owner_can_invite_admin",
          }),
        }),
      );
    });

    it("permits an admin inviting another internal user", async () => {
      await expect(
        createInvitation(
          {
            kind: "internal",
            role: "internal",
            email: "newcontrib@example.com",
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "admin",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).resolves.not.toThrow();
    });

    it("permits an owner inviting an admin", async () => {
      await expect(
        createInvitation(
          {
            kind: "internal",
            role: "admin",
            email: "newadmin@example.com",
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "owner",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("happy path — internal invite", () => {
    it("calls WorkOS with the org's and inviter's WorkOS ids, mirrors the row, audits", async () => {
      const result = await createInvitation(
        {
          kind: "internal",
          role: "internal",
          email: "invitee@example.com",
          orgId: ORG_ID,
          actorId: ACTOR_ID,
          actorRole: "owner",
          audit: AUDIT_CTX,
        },
        deps,
      );

      expect(deps.createInvitation).toHaveBeenCalledWith({
        email: "invitee@example.com",
        organizationId: ORG_WORKOS_ID,
        inviterUserId: ACTOR_WORKOS_ID,
        expiresInDays: 7,
      });
      expect(deps.invitationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          workosInvitationId: WORKOS_INVITATION_ID,
          orgId: ORG_ID,
          email: "invitee@example.com",
          kind: "internal",
          role: "internal",
          opportunitySlug: null,
          invitedBy: ACTOR_ID,
        }),
      );
      expect(result.id).toBe(INVITATION_ID);
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "invite_sent",
          outcome: "success",
          actorUserId: ACTOR_ID,
          orgId: ORG_ID,
          metadata: expect.objectContaining({
            invitationId: INVITATION_ID,
            kind: "internal",
            role: "internal",
            email: "invitee@example.com",
          }),
        }),
      );
    });
  });

  describe("happy path — external invite", () => {
    it("persists opportunitySlug instead of role", async () => {
      deps.invitationCreate.mockResolvedValue(
        makeInvitation({
          kind: "external",
          role: null,
          opportunitySlug: "vendor-a",
        }),
      );

      await createInvitation(
        {
          kind: "external",
          opportunitySlug: "vendor-a",
          email: "vendor@example.com",
          orgId: ORG_ID,
          actorId: ACTOR_ID,
          actorRole: "owner",
          audit: AUDIT_CTX,
        },
        deps,
      );

      expect(deps.invitationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "external",
          role: null,
          opportunitySlug: "vendor-a",
        }),
      );
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            kind: "external",
            opportunitySlug: "vendor-a",
          }),
        }),
      );
    });
  });

  describe("data-integrity rejections", () => {
    it("rejects when the inviter row is missing locally", async () => {
      deps.userFindById.mockResolvedValue(null);

      await expect(
        createInvitation(
          {
            kind: "internal",
            role: "internal",
            email: "invitee@example.com",
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "owner",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(/inviter_user_not_found/);

      expect(deps.createInvitation).not.toHaveBeenCalled();
    });

    it("rejects when the org row is missing locally", async () => {
      deps.orgFindById.mockResolvedValue(null);

      await expect(
        createInvitation(
          {
            kind: "internal",
            role: "internal",
            email: "invitee@example.com",
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "owner",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(/org_not_found/);

      expect(deps.createInvitation).not.toHaveBeenCalled();
    });
  });
});

// ─── listInvitations ─────────────────────────────────────────────────

describe("listInvitations", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the rows from the repo, defaulting to state=pending", async () => {
    const rows = [makeInvitation()];
    deps.invitationListByOrgAndState.mockResolvedValue(rows);

    const result = await listInvitations({ orgId: ORG_ID }, deps);

    expect(deps.invitationListByOrgAndState).toHaveBeenCalledWith(
      ORG_ID,
      "pending",
    );
    expect(result).toBe(rows);
  });

  it("forwards an explicit state filter", async () => {
    deps.invitationListByOrgAndState.mockResolvedValue([]);
    await listInvitations({ orgId: ORG_ID, state: "accepted" }, deps);
    expect(deps.invitationListByOrgAndState).toHaveBeenCalledWith(
      ORG_ID,
      "accepted",
    );
  });

  it("does not emit an audit event for read operations", async () => {
    deps.invitationListByOrgAndState.mockResolvedValue([]);
    await listInvitations({ orgId: ORG_ID }, deps);
    expect(deps.auditWrite).not.toHaveBeenCalled();
  });
});

// ─── revokeInvitation ────────────────────────────────────────────────

describe("revokeInvitation", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
    deps.invitationFindById.mockResolvedValue(makeInvitation());
    deps.invitationTransitionState.mockResolvedValue(
      makeInvitation({ state: "revoked" }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("authorization", () => {
    it("rejects internal-role actors", async () => {
      await expect(
        revokeInvitation(
          {
            invitationId: INVITATION_ID,
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "internal",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(/actor_role_insufficient/);

      expect(deps.revokeInvitation).not.toHaveBeenCalled();
      expect(deps.invitationTransitionState).not.toHaveBeenCalled();
    });
  });

  describe("FR10 — revoke unaccepted invite", () => {
    it("revokes via WorkOS, flips state, and audits success", async () => {
      const result = await revokeInvitation(
        {
          invitationId: INVITATION_ID,
          orgId: ORG_ID,
          actorId: ACTOR_ID,
          actorRole: "admin",
          audit: AUDIT_CTX,
        },
        deps,
      );

      expect(deps.revokeInvitation).toHaveBeenCalledWith(WORKOS_INVITATION_ID);
      expect(deps.invitationTransitionState).toHaveBeenCalledWith(
        INVITATION_ID,
        "pending",
        "revoked",
      );
      expect(result.state).toBe("revoked");
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "invite_revoked",
          outcome: "success",
          actorUserId: ACTOR_ID,
          orgId: ORG_ID,
          metadata: expect.objectContaining({
            invitationId: INVITATION_ID,
            workosInvitationId: WORKOS_INVITATION_ID,
          }),
        }),
      );
    });

    it("revokes via WorkOS BEFORE flipping local state", async () => {
      // Defends the spec's ordering rationale: WorkOS revoke first
      // so a partial failure can't leave a still-acceptable WorkOS
      // token while we already think the invite is revoked.
      await revokeInvitation(
        {
          invitationId: INVITATION_ID,
          orgId: ORG_ID,
          actorId: ACTOR_ID,
          actorRole: "owner",
          audit: AUDIT_CTX,
        },
        deps,
      );
      const revokeOrder = deps.revokeInvitation.mock.invocationCallOrder[0]!;
      const setStateOrder =
        deps.invitationTransitionState.mock.invocationCallOrder[0]!;
      expect(revokeOrder).toBeLessThan(setStateOrder);
    });

    it("rejects when the invitation is missing", async () => {
      deps.invitationFindById.mockResolvedValue(null);

      await expect(
        revokeInvitation(
          {
            invitationId: INVITATION_ID,
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "owner",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(/invitation_not_found/);
      expect(deps.revokeInvitation).not.toHaveBeenCalled();
    });

    it("rejects revoke when the invitation belongs to a different org (cross-org guard)", async () => {
      // Defends against tenancy bypass: the handler validates the
      // actor's role in `input.orgId`, but `invitationId` is a
      // globally-unique PK. A tenant-A admin passing a tenant-B
      // invitation id must not be able to revoke it. Bugbot caught
      // this on PR #15 — high-severity finding.
      const otherOrgId = "99999999-9999-4999-8999-999999999999";
      deps.invitationFindById.mockResolvedValue(
        makeInvitation({ orgId: otherOrgId }),
      );

      await expect(
        revokeInvitation(
          {
            invitationId: INVITATION_ID,
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "owner",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(/invitation_not_found/);

      // Crucially, no WorkOS revoke and no local state flip. The
      // tenant-B invitation must be untouched.
      expect(deps.revokeInvitation).not.toHaveBeenCalled();
      expect(deps.invitationTransitionState).not.toHaveBeenCalled();

      // Audit the attempt with the actor's requested org as the
      // top-level orgId, plus the actual owning org in metadata so
      // an operator can spot the cross-org probe.
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "invite_revoked",
          outcome: "failure",
          actorUserId: ACTOR_ID,
          orgId: ORG_ID,
          metadata: expect.objectContaining({
            reason: "invitation_not_found",
            actualOrgId: otherOrgId,
          }),
        }),
      );
    });

    it("throws invitation_state_race when transitionState returns null (concurrent accept won)", async () => {
      // Defends against an `acceptInvitation` webhook delivery
      // landing between our `findById` and our `transitionState`.
      // The conditional UPDATE returns null (state moved off
      // pending), and we surface a typed race error rather than
      // silently overwriting the new state back to revoked.
      deps.invitationTransitionState.mockResolvedValue(null);

      await expect(
        revokeInvitation(
          {
            invitationId: INVITATION_ID,
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "owner",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(/invitation_state_race/);

      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "invite_revoked",
          outcome: "failure",
          metadata: expect.objectContaining({
            reason: "invitation_state_race",
          }),
        }),
      );
    });

    it("rejects revoke against an already-accepted invitation", async () => {
      deps.invitationFindById.mockResolvedValue(
        makeInvitation({ state: "accepted", acceptedAt: NOW }),
      );

      await expect(
        revokeInvitation(
          {
            invitationId: INVITATION_ID,
            orgId: ORG_ID,
            actorId: ACTOR_ID,
            actorRole: "owner",
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(/invitation_not_pending/);

      expect(deps.revokeInvitation).not.toHaveBeenCalled();
      expect(deps.invitationTransitionState).not.toHaveBeenCalled();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: "failure",
          metadata: expect.objectContaining({
            reason: "invitation_not_pending",
          }),
        }),
      );
    });
  });
});

// ─── acceptInvitation ────────────────────────────────────────────────

describe("acceptInvitation", () => {
  let deps: MockDeps;

  const ACCEPT_INPUT = {
    workosInvitationId: WORKOS_INVITATION_ID,
    workosUserId: ACCEPTING_WORKOS_USER_ID,
    email: "invitee@example.com",
    fullName: "Invitee Person",
    emailVerified: true,
    audit: AUDIT_CTX,
  };

  function makeAcceptedUser(): User {
    return makeUser({
      id: ACCEPTING_USER_ID,
      workosUserId: ACCEPTING_WORKOS_USER_ID,
      email: "invitee@example.com",
      fullName: "Invitee Person",
    });
  }

  beforeEach(() => {
    deps = makeDeps();
    // Default to "fresh acceptance" — invitation pending, user not
    // yet mirrored. Each test overrides as needed.
    deps.invitationFindByWorkosInvitationId.mockResolvedValue(makeInvitation());
    deps.userFindByWorkosUserId.mockResolvedValue(null);
    deps.userCreate.mockResolvedValue(makeAcceptedUser());
    deps.invitationTransitionState.mockResolvedValue(
      makeInvitation({ state: "accepted", acceptedAt: NOW }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("internal invite — happy path", () => {
    it("creates user + membership + flips invitation, all inside db.transaction", async () => {
      const membership: OrgMembership = {
        id: "55555555-5555-4555-8555-555555555555",
        orgId: ORG_ID,
        userId: ACCEPTING_USER_ID,
        role: "internal",
        createdAt: NOW,
        updatedAt: NOW,
      };
      deps.membershipCreate.mockResolvedValue(membership);

      const result = await acceptInvitation(ACCEPT_INPUT, deps);

      expect(deps.dbTransaction).toHaveBeenCalledTimes(1);
      expect(deps.userWithTx).toHaveBeenCalledWith(TX_SENTINEL);
      expect(deps.membershipWithTx).toHaveBeenCalledWith(TX_SENTINEL);
      expect(deps.invitationWithTx).toHaveBeenCalledWith(TX_SENTINEL);
      expect(deps.userCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          workosUserId: ACCEPTING_WORKOS_USER_ID,
          email: "invitee@example.com",
          fullName: "Invitee Person",
        }),
      );
      expect(deps.membershipCreate).toHaveBeenCalledWith({
        orgId: ORG_ID,
        userId: ACCEPTING_USER_ID,
        role: "internal",
      });
      expect(deps.externalGrantCreate).not.toHaveBeenCalled();
      expect(deps.invitationTransitionState).toHaveBeenCalledWith(
        INVITATION_ID,
        "pending",
        "accepted",
      );

      expect(result.user?.id).toBe(ACCEPTING_USER_ID);
      expect(result.membership).toEqual(membership);
      expect(result.grant).toBeNull();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "invite_accepted",
          outcome: "success",
          targetUserId: ACCEPTING_USER_ID,
          orgId: ORG_ID,
        }),
      );
    });

    it("reuses the existing user mirror when the WorkOS user is already known", async () => {
      const existing = makeAcceptedUser();
      deps.userFindByWorkosUserId.mockResolvedValue(existing);

      await acceptInvitation(ACCEPT_INPUT, deps);

      expect(deps.userCreate).not.toHaveBeenCalled();
      expect(deps.membershipCreate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: existing.id }),
      );
    });
  });

  describe("external invite — happy path", () => {
    it("creates user + grant (not membership) and flips invitation", async () => {
      deps.invitationFindByWorkosInvitationId.mockResolvedValue(
        makeInvitation({
          kind: "external",
          role: null,
          opportunitySlug: "vendor-a",
        }),
      );
      const grant: ExternalAccessGrant = {
        id: "66666666-6666-4666-8666-666666666666",
        orgId: ORG_ID,
        userId: ACCEPTING_USER_ID,
        opportunitySlug: "vendor-a",
        grantedBy: ACTOR_ID,
        status: "active",
        expiresAt: new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000),
        createdAt: NOW,
        updatedAt: NOW,
      };
      deps.externalGrantCreate.mockResolvedValue(grant);

      const result = await acceptInvitation(ACCEPT_INPUT, deps);

      // FR8b: grant must carry a 90-day default expiry. The exact
      // millisecond depends on `now` inside the application function,
      // so we pin the shape and assert the value via a tolerance
      // window on a separate line.
      expect(deps.externalGrantCreate).toHaveBeenCalledWith({
        orgId: ORG_ID,
        userId: ACCEPTING_USER_ID,
        opportunitySlug: "vendor-a",
        grantedBy: ACTOR_ID,
        expiresAt: expect.any(Date),
      });
      const grantCallArg = deps.externalGrantCreate.mock.calls[0]?.[0] as {
        expiresAt: Date;
      };
      const driftMs = Math.abs(
        grantCallArg.expiresAt.getTime() -
          (Date.now() + 90 * 24 * 60 * 60 * 1000),
      );
      expect(driftMs).toBeLessThan(5_000);
      expect(deps.membershipCreate).not.toHaveBeenCalled();
      expect(result.grant).toEqual(grant);
      expect(result.membership).toBeNull();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            kind: "external",
            opportunitySlug: "vendor-a",
          }),
        }),
      );
    });
  });

  describe("webhook idempotency", () => {
    it("returns null + audits failure when the invitation is unknown (no throw)", async () => {
      deps.invitationFindByWorkosInvitationId.mockResolvedValue(null);

      const result = await acceptInvitation(
        { ...ACCEPT_INPUT, workosInvitationId: "invitation_unknown" },
        deps,
      );

      expect(result).toEqual({
        invitation: null,
        user: null,
        membership: null,
        grant: null,
      });
      expect(deps.dbTransaction).not.toHaveBeenCalled();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: "failure",
          metadata: expect.objectContaining({
            reason: "invitation_not_found",
            workosInvitationId: "invitation_unknown",
          }),
        }),
      );
    });

    it("no-ops on redelivery against an already-accepted invitation", async () => {
      const accepted = makeInvitation({
        state: "accepted",
        acceptedAt: NOW,
      });
      deps.invitationFindByWorkosInvitationId.mockResolvedValue(accepted);

      const result = await acceptInvitation(ACCEPT_INPUT, deps);

      expect(result.invitation).toBe(accepted);
      expect(result.user).toBeNull();
      expect(deps.dbTransaction).not.toHaveBeenCalled();
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: "failure",
          metadata: expect.objectContaining({
            reason: "invitation_not_pending",
            currentState: "accepted",
          }),
        }),
      );
    });
  });

  describe("multi-write rollback", () => {
    it("does not emit a success audit when the membership insert fails inside the transaction", async () => {
      deps.membershipCreate.mockRejectedValue(new Error("FK violation"));

      await expect(acceptInvitation(ACCEPT_INPUT, deps)).rejects.toThrow(
        /FK violation/,
      );
      const successCalls = deps.auditWrite.mock.calls.filter(
        ([event]) => event.outcome === "success",
      );
      expect(successCalls).toHaveLength(0);
    });
  });

  describe("schema-invariant defence (DB drift)", () => {
    it("throws invitation_invariant_violation when an internal invite has a null role", async () => {
      // Defends against a manual DB update that lets a null role
      // through despite the schema's superRefine. Otherwise the
      // membership insert would surface as an opaque Drizzle NOT
      // NULL constraint violation, much harder to diagnose.
      deps.invitationFindByWorkosInvitationId.mockResolvedValue(
        makeInvitation({ kind: "internal", role: null }),
      );

      await expect(acceptInvitation(ACCEPT_INPUT, deps)).rejects.toThrow(
        /invitation_invariant_violation/,
      );
      expect(deps.membershipCreate).not.toHaveBeenCalled();
    });

    it("throws invitation_invariant_violation when an external invite has a null opportunitySlug", async () => {
      deps.invitationFindByWorkosInvitationId.mockResolvedValue(
        makeInvitation({ kind: "external", role: null, opportunitySlug: null }),
      );

      await expect(acceptInvitation(ACCEPT_INPUT, deps)).rejects.toThrow(
        /invitation_invariant_violation/,
      );
      expect(deps.externalGrantCreate).not.toHaveBeenCalled();
    });
  });

  describe("TOCTOU race against concurrent accept / revoke", () => {
    it("throws invitation_state_race when transitionState returns null inside the txn", async () => {
      // Simulates two concurrent webhook deliveries: both pass the
      // pre-transaction `state === "pending"` check, both enter the
      // transaction, but only one wins the conditional UPDATE. The
      // loser's transitionState returns null and we throw — Drizzle
      // rolls the user / membership / grant inserts back, so the
      // external-grant duplicate Bugbot flagged on PR #15 cannot
      // happen.
      deps.invitationTransitionState.mockResolvedValue(null);

      await expect(acceptInvitation(ACCEPT_INPUT, deps)).rejects.toThrow(
        /invitation_state_race/,
      );

      expect(deps.invitationTransitionState).toHaveBeenCalledWith(
        INVITATION_ID,
        "pending",
        "accepted",
      );
      // Failure audit is emitted from the catch block outside the
      // transaction; the success audit must not fire.
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "invite_accepted",
          outcome: "failure",
          metadata: expect.objectContaining({
            reason: "invitation_state_race",
            invitationId: INVITATION_ID,
          }),
        }),
      );
      const successCalls = deps.auditWrite.mock.calls.filter(
        ([event]) => event.outcome === "success",
      );
      expect(successCalls).toHaveLength(0);
    });

    it("does not create a duplicate external_access_grant when the race is lost", async () => {
      // The membership table has a unique (org_id, user_id) index
      // that catches duplicates. external_access_grants does NOT —
      // hence the explicit transitionState guard. This test pins
      // that contract specifically for the external path.
      deps.invitationFindByWorkosInvitationId.mockResolvedValue(
        makeInvitation({
          kind: "external",
          role: null,
          opportunitySlug: "vendor-a",
        }),
      );
      deps.invitationTransitionState.mockResolvedValue(null);

      await expect(acceptInvitation(ACCEPT_INPUT, deps)).rejects.toThrow(
        /invitation_state_race/,
      );

      // The grant `create` ran inside the transaction (before the
      // transitionState check), but the throw rolls it back via
      // Drizzle. We can't assert on rollback in a mocked
      // transaction, so we instead pin that the audit recorded the
      // race rather than a success — the integration test in
      // invitationRepo.integration.test.ts proves the actual
      // rollback against a real Postgres tx.
      expect(deps.externalGrantCreate).toHaveBeenCalledTimes(1);
      const successCalls = deps.auditWrite.mock.calls.filter(
        ([event]) => event.outcome === "success",
      );
      expect(successCalls).toHaveLength(0);
    });
  });
});
