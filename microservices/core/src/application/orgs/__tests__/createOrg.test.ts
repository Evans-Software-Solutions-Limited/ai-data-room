// Unit tests for `createOrg` (slice 17 / org-provisioning T-002).
//
// Mocks the WorkOS wrapper, repos, audit repo, event publisher, and the
// `db.transaction` shape (same pattern as `invitations.test.ts`). Real
// `recordAuditEvent` runs against a mocked `AuditRepo.write` so the
// emitted audit shapes are exercised, not stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { metrics } from "../../../infrastructure/observability/metrics";
import type { Db } from "@ai-data-room/db";
import type {
  Org,
  OrgMembership,
} from "@ai-data-room/api-utils/schemas/auth-orgs";
import type { AuditRepo } from "../../../infrastructure/db/auditRepo";
import type { TenantBootstrapRepo } from "../../../infrastructure/db/bootstrapRepo";
import type { OrgRepo } from "../../../infrastructure/db/orgRepo";
import { scopedRepo } from "../../../infrastructure/db/scoped";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import type { OrgEventPublisher } from "../../../infrastructure/events/orgEventPublisher";
import type { WorkOSClient } from "../../../infrastructure/workos/client";

import { createOrg, CreateOrgError } from "../createOrg";

// T-004: `createOrg` now binds the owner-membership write via
// `scopedRepo(org.id, tx)` INSIDE the transaction (the org doesn't
// exist — and therefore the scope can't be bound — until the insert
// just above it), rather than through an injected `membershipRepo`
// dep. Mock the factory itself so the test can still assert on the
// `create()` call shape without hitting real Drizzle/Postgres.
vi.mock("../../../infrastructure/db/scoped", () => ({
  scopedRepo: vi.fn(),
}));

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

  // Bootstrap: the pre-tx FR5 guard + the in-tx advisory-lock/race-recheck.
  // `withTx` returns the SAME bootstrap object (same `findByUser` fn) so a
  // test can drive both the pre-tx and in-tx calls through one mock, same
  // as the pre-T-004 shape.
  const findByUser = vi.fn().mockResolvedValue(null);
  const lockForUserCreate = vi.fn().mockResolvedValue(undefined);
  const bootstrapWithTx = vi.fn();
  const bootstrap = {
    findMembershipForUser: findByUser,
    lockForUserCreate,
    withTx: bootstrapWithTx,
  } as unknown as TenantBootstrapRepo;
  bootstrapWithTx.mockReturnValue(bootstrap);

  // Owner-membership write: `scopedRepo(org.id, tx).membership.create(...)`.
  const membershipCreate = vi.fn().mockResolvedValue(MEMBERSHIP);
  vi.mocked(scopedRepo).mockReturnValue({
    membership: {
      create: membershipCreate,
    } as unknown as ScopedRepos["membership"],
    invitations: {} as unknown as ScopedRepos["invitations"],
    externalGrants: {} as unknown as ScopedRepos["externalGrants"],
    auditReads: {} as unknown as ScopedRepos["auditReads"],
    opportunities: {} as unknown as ScopedRepos["opportunities"],
    documents: {} as unknown as ScopedRepos["documents"],
    documentVersions: {} as unknown as ScopedRepos["documentVersions"],
    documentDeletions: {} as unknown as ScopedRepos["documentDeletions"],
    withTx: vi.fn(),
  });

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
      bootstrap,
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

/** A postgres-js-shaped unique violation on the org slug index. */
function slugConflictError() {
  return Object.assign(
    new Error(
      'duplicate key value violates unique constraint "organizations_slug_key"',
    ),
    { code: "23505", constraint_name: "organizations_slug_key" },
  );
}

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the WorkOS org, local mirror, and owner membership, then emits org.created", async () => {
    const addMetric = vi.spyOn(metrics, "addMetric");
    const result = await createOrg(params, m.deps);

    expect(result).toMatchObject({ orgId: ORG_ID, role: "owner" });
    expect(m.createOrganization).toHaveBeenCalledWith({ name: "Acme Ltd" });
    expect(m.orgCreate).toHaveBeenCalledWith({
      workosOrgId: WORKOS_ORG_ID,
      name: "Acme Ltd",
      slug: "acme-ltd",
    });
    // T-004: org isn't stamped explicitly — it's bound by
    // `scopedRepo(org.id, tx)`, asserted separately below.
    expect(m.membershipCreate).toHaveBeenCalledWith({
      userId: ACTOR_ID,
      role: "owner",
    });
    expect(scopedRepo).toHaveBeenCalledWith(ORG_ID, TX);
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
    // The successful provision meters create-count + latency
    // (design §Observability `org.create.latency_ms`).
    const emitted = addMetric.mock.calls.map((c) => c[0]);
    expect(emitted).toContain("org.created.count");
    expect(emitted).toContain("org.create.latency_ms");
  });

  it("rejects a caller who already has a membership (FR5), counts the failure, without touching WorkOS", async () => {
    const addMetric = vi.spyOn(metrics, "addMetric");
    m.findByUser.mockResolvedValue(MEMBERSHIP);

    await expect(createOrg(params, m.deps)).rejects.toMatchObject({
      reason: "already_member",
    });
    expect(m.createOrganization).not.toHaveBeenCalled();
    expect(m.orgCreate).not.toHaveBeenCalled();
    expect(auditEventTypes(m.auditWrite)).toEqual([
      { eventType: "org_created", outcome: "failure" },
    ]);
    // The fast-path rejection must feed org.create.failures, like every
    // other failure path (was previously audit-only).
    expect(
      addMetric.mock.calls.some((c) => c[0] === "org.create.failures"),
    ).toBe(true);
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
    // The race-loser audit keeps the colliding org's id (parity with the
    // other FR5 paths) rather than null.
    expect(m.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "org_created",
        outcome: "failure",
        orgId: ORG_ID,
      }),
    );
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

  it("retries on a concurrent slug collision and succeeds (no 500, WorkOS org reused)", async () => {
    // A different user committed the same slug between our findBySlug and
    // insert → the first insert hits organizations_slug_key; the retry
    // re-derives and succeeds.
    m.orgCreate
      .mockRejectedValueOnce(slugConflictError())
      .mockResolvedValue(ORG);

    const result = await createOrg(params, m.deps);

    expect(result.orgId).toBe(ORG_ID);
    expect(m.orgCreate).toHaveBeenCalledTimes(2);
    expect(m.createOrganization).toHaveBeenCalledTimes(1); // not re-minted
    expect(m.deleteOrganization).not.toHaveBeenCalled();
    expect(m.emitOrgCreated).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget on a persistent slug collision (compensates + 500)", async () => {
    m.orgCreate.mockRejectedValue(slugConflictError());

    await expect(createOrg(params, m.deps)).rejects.toMatchObject({
      reason: "provisioning_failed",
    });
    expect(m.orgCreate).toHaveBeenCalledTimes(3); // MAX_CREATE_ATTEMPTS
    expect(m.deleteOrganization).toHaveBeenCalledWith(WORKOS_ORG_ID);
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
