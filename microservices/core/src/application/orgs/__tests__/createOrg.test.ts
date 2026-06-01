// Unit tests for `createOrg` (slice 17 / org-provisioning T-002).
//
// Mocks the WorkOS wrapper, repos, audit repo, event publisher, and the
// `db.transaction` shape (same pattern as `invitations.test.ts`). Real
// `recordAuditEvent` runs against a mocked `AuditRepo.write` so the
// emitted audit shapes are exercised, not stubbed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "@ai-data-room/db";
import type {
  Org,
  OrgMembership,
} from "@ai-data-room/api-utils/schemas/auth-orgs";
import type { AuditRepo } from "../../../infrastructure/db/auditRepo";
import type { MembershipRepo } from "../../../infrastructure/db/membershipRepo";
import type { OrgRepo } from "../../../infrastructure/db/orgRepo";
import type { OrgEventPublisher } from "../../../infrastructure/events/orgEventPublisher";
import type { WorkOSClient } from "../../../infrastructure/workos/client";

import { createOrg, CreateOrgError } from "../createOrg";

const NOW = new Date("2026-06-01T10:00:00Z");
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const WORKOS_ORG_ID = "org_workos_new";
const AUDIT = { sourceIp: "203.0.113.5", userAgent: "test/1.0" } as const;
const TX = Symbol("tx");

const ORG: Org = {
  id: ORG_ID,
  workosOrgId: WORKOS_ORG_ID,
  name: "Acme Ltd",
  slug: "acme-ltd",
  status: "active",
  createdAt: NOW,
  updatedAt: NOW,
};

const MEMBERSHIP: OrgMembership = {
  id: MEMBERSHIP_ID,
  orgId: ORG_ID,
  userId: ACTOR_ID,
  role: "owner",
  createdAt: NOW,
  updatedAt: NOW,
};

interface Mocks {
  deps: Parameters<typeof createOrg>[1];
  createOrganization: ReturnType<typeof vi.fn>;
  deleteOrganization: ReturnType<typeof vi.fn>;
  findByUser: ReturnType<typeof vi.fn>;
  findBySlug: ReturnType<typeof vi.fn>;
  orgCreate: ReturnType<typeof vi.fn>;
  membershipCreate: ReturnType<typeof vi.fn>;
  auditWrite: ReturnType<typeof vi.fn>;
  emitOrgCreated: ReturnType<typeof vi.fn>;
}

function makeMocks(): Mocks {
  const createOrganization = vi.fn().mockResolvedValue({ id: WORKOS_ORG_ID });
  const deleteOrganization = vi.fn().mockResolvedValue(undefined);

  const findByUser = vi.fn().mockResolvedValue(null);
  const membershipCreate = vi.fn().mockResolvedValue(MEMBERSHIP);
  const lockForUserCreate = vi.fn().mockResolvedValue(undefined);
  const membershipWithTx = vi.fn();
  const membershipRepo = {
    findByUser,
    create: membershipCreate,
    lockForUserCreate,
    withTx: membershipWithTx,
  } as unknown as MembershipRepo;
  membershipWithTx.mockReturnValue(membershipRepo);

  const findBySlug = vi.fn().mockResolvedValue(null);
  const orgCreate = vi.fn().mockResolvedValue(ORG);
  const orgWithTx = vi.fn();
  const orgRepo = {
    findBySlug,
    create: orgCreate,
    withTx: orgWithTx,
  } as unknown as OrgRepo;
  orgWithTx.mockReturnValue(orgRepo);

  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });
  const auditRepo = { write: auditWrite } as unknown as AuditRepo;

  const emitOrgCreated = vi.fn().mockResolvedValue(undefined);
  const events = { emitOrgCreated } as OrgEventPublisher;

  const db = {
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(TX)),
  } as unknown as Db;

  return {
    deps: {
      db,
      workos: { createOrganization, deleteOrganization } as unknown as Pick<
        WorkOSClient,
        "createOrganization" | "deleteOrganization"
      >,
      orgRepo,
      membershipRepo,
      auditRepo,
      events,
    },
    createOrganization,
    deleteOrganization,
    findByUser,
    findBySlug,
    orgCreate,
    membershipCreate,
    auditWrite,
    emitOrgCreated,
  };
}

const params = {
  actorUserId: ACTOR_ID,
  input: { name: "Acme Ltd" },
  audit: AUDIT,
};

function auditEventTypes(auditWrite: ReturnType<typeof vi.fn>) {
  return auditWrite.mock.calls.map((c) => ({
    eventType: c[0].eventType,
    outcome: c[0].outcome,
  }));
}

describe("createOrg", () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeMocks();
  });

  it("creates the WorkOS org, local mirror, and owner membership, then emits org.created", async () => {
    const result = await createOrg(params, m.deps);

    expect(result).toMatchObject({ orgId: ORG_ID, role: "owner" });
    expect(m.createOrganization).toHaveBeenCalledWith({ name: "Acme Ltd" });
    expect(m.orgCreate).toHaveBeenCalledWith({
      workosOrgId: WORKOS_ORG_ID,
      name: "Acme Ltd",
      slug: "acme-ltd",
    });
    expect(m.membershipCreate).toHaveBeenCalledWith({
      orgId: ORG_ID,
      userId: ACTOR_ID,
      role: "owner",
    });
    expect(m.deleteOrganization).not.toHaveBeenCalled();
    expect(m.emitOrgCreated).toHaveBeenCalledWith({
      orgId: ORG_ID,
      workosOrgId: WORKOS_ORG_ID,
      ownerUserId: ACTOR_ID,
    });
    expect(auditEventTypes(m.auditWrite)).toEqual([
      { eventType: "org_created", outcome: "success" },
      { eventType: "membership_created", outcome: "success" },
    ]);
  });

  it("rejects a caller who already has a membership (FR5), without touching WorkOS", async () => {
    m.findByUser.mockResolvedValue(MEMBERSHIP);

    await expect(createOrg(params, m.deps)).rejects.toMatchObject({
      reason: "already_member",
    });
    expect(m.createOrganization).not.toHaveBeenCalled();
    expect(m.orgCreate).not.toHaveBeenCalled();
    expect(auditEventTypes(m.auditWrite)).toEqual([
      { eventType: "org_created", outcome: "failure" },
    ]);
  });

  it("compensates and surfaces already_member when a concurrent create wins the FR5 race", async () => {
    // Pre-tx guard passes (null), but the in-tx re-check (under the
    // advisory lock) finds a membership the racing request just created.
    m.findByUser.mockResolvedValueOnce(null).mockResolvedValueOnce(MEMBERSHIP);

    await expect(createOrg(params, m.deps)).rejects.toMatchObject({
      reason: "already_member",
    });
    // The WorkOS org was minted pre-tx, so it must be compensated.
    expect(m.createOrganization).toHaveBeenCalled();
    expect(m.deleteOrganization).toHaveBeenCalledWith(WORKOS_ORG_ID);
    // Nothing persisted, no success.
    expect(m.membershipCreate).not.toHaveBeenCalled();
    expect(m.emitOrgCreated).not.toHaveBeenCalled();
  });

  it("throws provisioning_failed and never enters the tx when the WorkOS create fails", async () => {
    m.createOrganization.mockRejectedValue(new Error("workos 500"));

    await expect(createOrg(params, m.deps)).rejects.toBeInstanceOf(
      CreateOrgError,
    );
    expect(m.orgCreate).not.toHaveBeenCalled();
    expect(m.deleteOrganization).not.toHaveBeenCalled();
    expect(auditEventTypes(m.auditWrite)).toEqual([
      { eventType: "org_created", outcome: "failure" },
    ]);
  });

  it("compensates (deletes the WorkOS org) and leaves no orphan when the tx fails", async () => {
    m.membershipCreate.mockRejectedValue(new Error("unique violation"));

    await expect(createOrg(params, m.deps)).rejects.toMatchObject({
      reason: "provisioning_failed",
    });
    expect(m.deleteOrganization).toHaveBeenCalledWith(WORKOS_ORG_ID);
    // No success audit; only the failure row.
    expect(auditEventTypes(m.auditWrite)).toEqual([
      { eventType: "org_created", outcome: "failure" },
    ]);
    expect(m.emitOrgCreated).not.toHaveBeenCalled();
  });

  it("still throws provisioning_failed if the compensating delete also fails", async () => {
    m.membershipCreate.mockRejectedValue(new Error("unique violation"));
    m.deleteOrganization.mockRejectedValue(new Error("workos delete 500"));

    await expect(createOrg(params, m.deps)).rejects.toMatchObject({
      reason: "provisioning_failed",
    });
  });

  it("derives a collision-free slug", async () => {
    // base "acme-ltd" taken, "acme-ltd-2" free.
    m.findBySlug.mockResolvedValueOnce(ORG).mockResolvedValueOnce(null);

    await createOrg(params, m.deps);

    expect(m.orgCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "acme-ltd-2" }),
    );
  });

  it("succeeds even if the org.created emit fails (best-effort)", async () => {
    m.emitOrgCreated.mockRejectedValue(new Error("eventbridge down"));

    const result = await createOrg(params, m.deps);

    expect(result.orgId).toBe(ORG_ID);
    expect(auditEventTypes(m.auditWrite)).toEqual([
      { eventType: "org_created", outcome: "success" },
      { eventType: "membership_created", outcome: "success" },
    ]);
  });
});
