// Unit tests for the Opportunity CRUD application functions.
//
// Mocks `OpportunityRepo` / `ExternalGrantRepo` / `AuditRepo` via
// `vi.fn()`; real `recordAuditEvent`/`safeAudit` against the mocked
// `AuditRepo` — same pattern as `invitations.test.ts`. `deps.db.transaction`
// is mocked to invoke its callback with a sentinel tx, and each repo's
// `withTx` returns the SAME mock object so the tx path is exercised
// without a real Drizzle handle.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditRepo } from "../../../infrastructure/db/auditRepo";
import type { ExternalGrantRepo } from "../../../infrastructure/db/externalGrantRepo";
import type { OpportunityRepo } from "../../../infrastructure/db/opportunityRepo";
import type { Db } from "@ai-data-room/db";
import type { Opportunity } from "@ai-data-room/api-utils/schemas/rooms";

import {
  archiveOpportunity,
  createOpportunity,
  listOpportunities,
  OpportunityError,
  renameOpportunity,
} from "../opportunities";

const NOW = new Date("2026-07-16T10:00:00Z");
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OPPORTUNITY_ID = "33333333-3333-4333-8333-333333333333";
const AUDIT_CTX = {
  sourceIp: "203.0.113.5",
  userAgent: "test/1.0",
} as const;
const TX_SENTINEL = Symbol("tx");

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: OPPORTUNITY_ID,
    orgId: ORG_ID,
    slug: "Vendor_A",
    name: "Vendor A",
    status: "active",
    archivedAt: null,
    createdBy: ACTOR_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

interface MockDeps {
  db: Db;
  dbTransaction: ReturnType<typeof vi.fn>;
  opportunities: OpportunityRepo;
  oppCreate: ReturnType<typeof vi.fn>;
  oppFindById: ReturnType<typeof vi.fn>;
  oppFindBySlug: ReturnType<typeof vi.fn>;
  oppRename: ReturnType<typeof vi.fn>;
  oppArchive: ReturnType<typeof vi.fn>;
  oppListActive: ReturnType<typeof vi.fn>;
  oppWithTx: ReturnType<typeof vi.fn>;
  externalGrants: ExternalGrantRepo;
  grantRevokeActiveForOpportunity: ReturnType<typeof vi.fn>;
  grantRetargetOpportunitySlug: ReturnType<typeof vi.fn>;
  grantWithTx: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const oppCreate = vi.fn();
  const oppFindById = vi.fn();
  const oppFindBySlug = vi.fn();
  const oppRename = vi.fn();
  const oppArchive = vi.fn();
  const oppListActive = vi.fn();
  const oppWithTx = vi.fn();
  const opportunities = {
    create: oppCreate,
    findById: oppFindById,
    findBySlug: oppFindBySlug,
    rename: oppRename,
    archive: oppArchive,
    listActive: oppListActive,
    withTx: oppWithTx,
    // `scopeOrgId` getter on the real ScopedRepo — a plain prop here so
    // the create failure audits (which stamp `deps.opportunities.scopeOrgId`)
    // carry the org.
    scopeOrgId: ORG_ID,
  } as unknown as OpportunityRepo;
  // withTx returns the same mock object so `.archive` calls inside the
  // transaction are the same spies asserted on outside it.
  oppWithTx.mockReturnValue(opportunities);

  const grantRevokeActiveForOpportunity = vi.fn();
  const grantRetargetOpportunitySlug = vi.fn().mockResolvedValue(0);
  const grantWithTx = vi.fn();
  const externalGrants = {
    revokeActiveForOpportunity: grantRevokeActiveForOpportunity,
    retargetOpportunitySlug: grantRetargetOpportunitySlug,
    withTx: grantWithTx,
  } as unknown as ExternalGrantRepo;
  grantWithTx.mockReturnValue(externalGrants);

  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  const dbTransaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb(TX_SENTINEL),
  );

  return {
    db: { transaction: dbTransaction } as unknown as Db,
    dbTransaction,
    opportunities,
    oppCreate,
    oppFindById,
    oppFindBySlug,
    oppRename,
    oppArchive,
    oppListActive,
    oppWithTx,
    externalGrants,
    grantRevokeActiveForOpportunity,
    grantRetargetOpportunitySlug,
    grantWithTx,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

// ─── createOpportunity ──────────────────────────────────────────────────

describe("createOpportunity", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
    deps.oppFindBySlug.mockResolvedValue(null);
    deps.oppCreate.mockResolvedValue(makeOpportunity());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates the opportunity and audits success", async () => {
    const result = await createOpportunity(
      {
        slug: "Vendor_A",
        name: "Vendor A",
        actorUserId: ACTOR_ID,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(deps.oppCreate).toHaveBeenCalledWith({
      slug: "Vendor_A",
      name: "Vendor A",
      createdBy: ACTOR_ID,
    });
    expect(result.id).toBe(OPPORTUNITY_ID);
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_created",
        outcome: "success",
        actorUserId: ACTOR_ID,
        orgId: ORG_ID,
        metadata: expect.objectContaining({
          opportunityId: OPPORTUNITY_ID,
          slug: "Vendor_A",
        }),
      }),
    );
  });

  it("defaults name to slug when name is omitted", async () => {
    await createOpportunity(
      { slug: "Vendor_A", actorUserId: ACTOR_ID, audit: AUDIT_CTX },
      deps,
    );

    expect(deps.oppCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "Vendor_A", name: "Vendor_A" }),
    );
  });

  it("defaults name to slug when name is blank", async () => {
    await createOpportunity(
      {
        slug: "Vendor_A",
        name: "   ",
        actorUserId: ACTOR_ID,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(deps.oppCreate).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "Vendor_A", name: "Vendor_A" }),
    );
  });

  it("rejects an invalid slug with no audit write", async () => {
    await expect(
      createOpportunity(
        { slug: "has a space", actorUserId: ACTOR_ID, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(/invalid_slug/);

    expect(deps.oppCreate).not.toHaveBeenCalled();
    expect(deps.auditWrite).not.toHaveBeenCalled();
  });

  it("rejects slug_taken via the findBySlug pre-check, audits failure", async () => {
    deps.oppFindBySlug.mockResolvedValue(makeOpportunity());

    await expect(
      createOpportunity(
        { slug: "Vendor_A", actorUserId: ACTOR_ID, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(OpportunityError);

    expect(deps.oppCreate).not.toHaveBeenCalled();
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_created",
        outcome: "failure",
        orgId: ORG_ID, // stamped from scopeOrgId so the failure is org-attributable
        metadata: expect.objectContaining({
          slug: "Vendor_A",
          reason: "slug_taken",
        }),
      }),
    );
  });

  it("translates a 23505 unique-violation from create() into slug_taken (race with a concurrent create)", async () => {
    deps.oppCreate.mockRejectedValue({ code: "23505" });

    await expect(
      createOpportunity(
        { slug: "Vendor_A", actorUserId: ACTOR_ID, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(/slug_taken/);

    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_created",
        outcome: "failure",
        orgId: ORG_ID,
        metadata: expect.objectContaining({ reason: "slug_taken" }),
      }),
    );
  });

  it("rethrows a non-unique-violation error from create() unchanged", async () => {
    deps.oppCreate.mockRejectedValue(new Error("connection reset"));

    await expect(
      createOpportunity(
        { slug: "Vendor_A", actorUserId: ACTOR_ID, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(/connection reset/);
  });
});

// ─── renameOpportunity ──────────────────────────────────────────────────

describe("renameOpportunity", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
    deps.oppFindById.mockResolvedValue(makeOpportunity({ slug: "Old_Slug" }));
    deps.oppRename.mockResolvedValue(
      makeOpportunity({ slug: "New_Slug", name: "New Name" }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renames and audits success with old + new slug", async () => {
    const result = await renameOpportunity(
      {
        id: OPPORTUNITY_ID,
        slug: "New_Slug",
        name: "New Name",
        actorUserId: ACTOR_ID,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(deps.oppRename).toHaveBeenCalledWith(OPPORTUNITY_ID, {
      slug: "New_Slug",
      name: "New Name",
    });
    expect(result.slug).toBe("New_Slug");
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_renamed",
        outcome: "success",
        metadata: expect.objectContaining({
          opportunityId: OPPORTUNITY_ID,
          oldSlug: "Old_Slug",
          newSlug: "New_Slug",
        }),
      }),
    );
  });

  it("defaults name to slug when name is omitted", async () => {
    await renameOpportunity(
      {
        id: OPPORTUNITY_ID,
        slug: "New_Slug",
        actorUserId: ACTOR_ID,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(deps.oppRename).toHaveBeenCalledWith(
      OPPORTUNITY_ID,
      expect.objectContaining({ slug: "New_Slug", name: "New_Slug" }),
    );
  });

  it("re-keys external grants (old→new slug) in the same tx when the slug changes (FR5)", async () => {
    await renameOpportunity(
      {
        id: OPPORTUNITY_ID,
        slug: "New_Slug",
        name: "New Name",
        actorUserId: ACTOR_ID,
        audit: AUDIT_CTX,
      },
      deps,
    );

    // Rename + re-key share the one transaction, both bound to its tx.
    expect(deps.dbTransaction).toHaveBeenCalledTimes(1);
    expect(deps.oppWithTx).toHaveBeenCalledWith(TX_SENTINEL);
    expect(deps.grantWithTx).toHaveBeenCalledWith(TX_SENTINEL);
    expect(deps.grantRetargetOpportunitySlug).toHaveBeenCalledWith(
      "Old_Slug",
      "New_Slug",
    );
  });

  it("does not re-key grants when the slug is unchanged (name-only rename)", async () => {
    deps.oppFindById.mockResolvedValue(makeOpportunity({ slug: "Same_Slug" }));
    deps.oppRename.mockResolvedValue(
      makeOpportunity({ slug: "Same_Slug", name: "New Name" }),
    );

    await renameOpportunity(
      {
        id: OPPORTUNITY_ID,
        slug: "Same_Slug",
        name: "New Name",
        actorUserId: ACTOR_ID,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(deps.grantRetargetOpportunitySlug).not.toHaveBeenCalled();
  });

  it("rejects an invalid slug with no audit write", async () => {
    await expect(
      renameOpportunity(
        {
          id: OPPORTUNITY_ID,
          slug: "bad slug!",
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      ),
    ).rejects.toThrow(/invalid_slug/);

    expect(deps.oppFindById).not.toHaveBeenCalled();
    expect(deps.auditWrite).not.toHaveBeenCalled();
  });

  it("rejects not_found when the id is unknown, audits failure", async () => {
    deps.oppFindById.mockResolvedValue(null);

    await expect(
      renameOpportunity(
        {
          id: OPPORTUNITY_ID,
          slug: "New_Slug",
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      ),
    ).rejects.toThrow(/not_found/);

    expect(deps.oppRename).not.toHaveBeenCalled();
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_renamed",
        outcome: "failure",
        metadata: expect.objectContaining({
          opportunityId: OPPORTUNITY_ID,
          reason: "not_found",
        }),
      }),
    );
  });

  it("translates a 23505 unique-violation from rename() into slug_taken", async () => {
    deps.oppRename.mockRejectedValue({ code: "23505" });

    await expect(
      renameOpportunity(
        {
          id: OPPORTUNITY_ID,
          slug: "Taken_Slug",
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      ),
    ).rejects.toThrow(/slug_taken/);

    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_renamed",
        outcome: "failure",
        metadata: expect.objectContaining({ reason: "slug_taken" }),
      }),
    );
  });

  it("rejects not_found when rename() returns null (lost a race with a concurrent delete)", async () => {
    deps.oppRename.mockResolvedValue(null);

    await expect(
      renameOpportunity(
        {
          id: OPPORTUNITY_ID,
          slug: "New_Slug",
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      ),
    ).rejects.toThrow(/not_found/);

    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_renamed",
        outcome: "failure",
        metadata: expect.objectContaining({ reason: "not_found" }),
      }),
    );
  });

  it("rethrows a non-unique-violation error from rename() unchanged", async () => {
    deps.oppRename.mockRejectedValue(new Error("connection reset"));

    await expect(
      renameOpportunity(
        {
          id: OPPORTUNITY_ID,
          slug: "New_Slug",
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      ),
    ).rejects.toThrow(/connection reset/);
  });
});

// ─── archiveOpportunity ──────────────────────────────────────────────────

describe("archiveOpportunity", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
    deps.oppFindById.mockResolvedValue(makeOpportunity({ status: "active" }));
    deps.oppArchive.mockResolvedValue(
      makeOpportunity({ status: "archived", archivedAt: NOW }),
    );
    deps.grantRevokeActiveForOpportunity.mockResolvedValue(2);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("archives, revokes grants for the slug, and audits success with grantsRevoked", async () => {
    const result = await archiveOpportunity(
      { id: OPPORTUNITY_ID, actorUserId: ACTOR_ID, audit: AUDIT_CTX },
      deps,
    );

    expect(deps.dbTransaction).toHaveBeenCalledTimes(1);
    expect(deps.oppWithTx).toHaveBeenCalledWith(TX_SENTINEL);
    expect(deps.grantWithTx).toHaveBeenCalledWith(TX_SENTINEL);
    expect(deps.oppArchive).toHaveBeenCalledWith(OPPORTUNITY_ID);
    expect(deps.grantRevokeActiveForOpportunity).toHaveBeenCalledWith(
      "Vendor_A",
    );
    expect(result.grantsRevoked).toBe(2);
    expect(result.opportunity.status).toBe("archived");
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_archived",
        outcome: "success",
        actorUserId: ACTOR_ID,
        orgId: ORG_ID,
        metadata: expect.objectContaining({
          opportunityId: OPPORTUNITY_ID,
          slug: "Vendor_A",
          grantsRevoked: 2,
        }),
      }),
    );
  });

  it("rejects not_found when the id is unknown, audits failure, never opens a transaction", async () => {
    deps.oppFindById.mockResolvedValue(null);

    await expect(
      archiveOpportunity(
        { id: OPPORTUNITY_ID, actorUserId: ACTOR_ID, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(/not_found/);

    expect(deps.dbTransaction).not.toHaveBeenCalled();
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_archived",
        outcome: "failure",
        metadata: expect.objectContaining({
          opportunityId: OPPORTUNITY_ID,
          reason: "not_found",
        }),
      }),
    );
  });

  it("rejects already_archived when the opportunity is already archived, audits failure, never opens a transaction", async () => {
    deps.oppFindById.mockResolvedValue(
      makeOpportunity({ status: "archived", archivedAt: NOW }),
    );

    await expect(
      archiveOpportunity(
        { id: OPPORTUNITY_ID, actorUserId: ACTOR_ID, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(/already_archived/);

    expect(deps.dbTransaction).not.toHaveBeenCalled();
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "opportunity_archived",
        outcome: "failure",
        metadata: expect.objectContaining({
          reason: "already_archived",
        }),
      }),
    );
  });

  it("throws already_archived when archive() loses a race inside the transaction, without revoking grants", async () => {
    deps.oppArchive.mockResolvedValue(null);

    await expect(
      archiveOpportunity(
        { id: OPPORTUNITY_ID, actorUserId: ACTOR_ID, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(/already_archived/);

    expect(deps.grantRevokeActiveForOpportunity).not.toHaveBeenCalled();
    const successCalls = deps.auditWrite.mock.calls.filter(
      ([event]) => event.outcome === "success",
    );
    expect(successCalls).toHaveLength(0);
  });
});

// ─── listOpportunities ──────────────────────────────────────────────────

describe("listOpportunities", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the repo's listActive() result", async () => {
    const rows = [makeOpportunity()];
    deps.oppListActive.mockResolvedValue(rows);

    const result = await listOpportunities(deps);

    expect(deps.oppListActive).toHaveBeenCalled();
    expect(result).toBe(rows);
  });

  it("does not emit an audit event for read operations", async () => {
    deps.oppListActive.mockResolvedValue([]);
    await listOpportunities(deps);
    expect(deps.auditWrite).not.toHaveBeenCalled();
  });
});
