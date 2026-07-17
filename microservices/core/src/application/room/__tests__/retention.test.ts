// Unit tests for the retention sweep orchestration (T-010).
//
// The sweep constructs a per-org `systemScope` internally (it must — it
// iterates many orgs), so we mock `systemScope` to inject fake per-org
// repos, and mock `hardDeleteDocument` (its own transaction/tag/audit logic
// is covered by deletion.test.ts) so these tests focus on retention's
// ORCHESTRATION: the cutoffs, per-org loop, the three sweep legs, the
// idempotent not_found handling, and the aggregated summary. The real
// end-to-end wiring is proven by deletion+retention integration tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeletionError } from "../deletion";

// Hoisted so the (hoisted) vi.mock factories below can reference them.
const { systemScopeMock, hardDeleteDocumentMock } = vi.hoisted(() => ({
  systemScopeMock: vi.fn(),
  hardDeleteDocumentMock: vi.fn(),
}));

vi.mock("../../../infrastructure/db/scoped", async (importActual) => {
  const actual =
    await importActual<typeof import("../../../infrastructure/db/scoped")>();
  return { ...actual, systemScope: systemScopeMock };
});

vi.mock("../deletion", async (importActual) => {
  const actual = await importActual<typeof import("../deletion")>();
  return { ...actual, hardDeleteDocument: hardDeleteDocumentMock };
});

// Imported AFTER the mocks are registered.
const { runRetentionSweep, DRAFT_MAX_AGE_HOURS } = await import("../retention");
const SOFT_DELETE_RETENTION_DAYS = 30; // asserted literal (defined in deletion.ts)

const NOW = new Date("2026-07-17T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Build a fake per-org scope whose repo reads default to empty. */
function makeScope(orgId: string) {
  const documents = {
    listSoftDeletedBefore: vi.fn().mockResolvedValue([]),
    listAllByOpportunity: vi.fn().mockResolvedValue([]),
    listExpiredDraftsBefore: vi.fn().mockResolvedValue([]),
    purgeDraft: vi.fn().mockResolvedValue({ id: "purged" }),
  };
  const opportunities = {
    listArchivedBefore: vi.fn().mockResolvedValue([]),
    hardDelete: vi.fn().mockResolvedValue({ id: "opp-gone" }),
  };
  return {
    orgId,
    repos: {
      documents,
      opportunities,
      documentVersions: {},
      documentDeletions: {},
    },
    audit: { actor: "system" as const, reason: "retention_sweep" },
  };
}

function makeDeps(orgIds: string[]) {
  return {
    db: { transaction: vi.fn() } as never,
    orgs: { listAllIds: vi.fn().mockResolvedValue(orgIds) } as never,
    store: {} as never,
    auditRepo: {} as never,
  };
}

describe("runRetentionSweep", () => {
  beforeEach(() => {
    hardDeleteDocumentMock.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("sweeps expired soft-deletes with a null actor + system audit metadata", async () => {
    const scope = makeScope("org-1");
    scope.repos.documents.listSoftDeletedBefore.mockResolvedValue([
      { id: "doc-a" },
      { id: "doc-b" },
    ]);
    systemScopeMock.mockReturnValue(scope);

    const summary = await runRetentionSweep({ now: NOW }, makeDeps(["org-1"]));

    // 30-day cutoff passed to the eligibility read.
    expect(scope.repos.documents.listSoftDeletedBefore).toHaveBeenCalledWith(
      new Date(NOW.getTime() - SOFT_DELETE_RETENTION_DAYS * DAY),
    );
    // Each expired doc hard-deleted as the system actor, carrying the
    // systemScope reason into the audit metadata (FR2).
    expect(hardDeleteDocumentMock).toHaveBeenCalledTimes(2);
    expect(hardDeleteDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-a",
        actorUserId: null,
        auditMetadata: { actor: "system", reason: "retention_sweep" },
      }),
      expect.anything(),
    );
    expect(summary).toEqual({
      orgsSwept: 1,
      orgsFailed: 0,
      documentsHardDeleted: 2,
      opportunitiesHardDeleted: 0,
      draftsPurged: 0,
    });
  });

  it("purges an expired archived subroom's documents THEN the opportunity row", async () => {
    const scope = makeScope("org-1");
    scope.repos.opportunities.listArchivedBefore.mockResolvedValue([
      { id: "opp-1" },
    ]);
    scope.repos.documents.listAllByOpportunity.mockResolvedValue([
      { id: "d1" },
      { id: "d2" },
    ]);
    systemScopeMock.mockReturnValue(scope);

    const summary = await runRetentionSweep({ now: NOW }, makeDeps(["org-1"]));

    expect(scope.repos.opportunities.listArchivedBefore).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 90 * DAY),
    );
    // Docs hard-deleted before the opportunity row (FK is ON DELETE NO ACTION).
    const hdOrder = hardDeleteDocumentMock.mock.invocationCallOrder[0];
    const oppOrder =
      scope.repos.opportunities.hardDelete.mock.invocationCallOrder[0];
    expect(hdOrder).toBeLessThan(oppOrder);
    expect(scope.repos.opportunities.hardDelete).toHaveBeenCalledWith("opp-1");
    expect(summary.documentsHardDeleted).toBe(2);
    expect(summary.opportunitiesHardDeleted).toBe(1);
  });

  it("purges drafts older than 24h via a plain scoped delete (no hard-delete path)", async () => {
    const scope = makeScope("org-1");
    scope.repos.documents.listExpiredDraftsBefore.mockResolvedValue([
      { id: "draft-1" },
    ]);
    systemScopeMock.mockReturnValue(scope);

    const summary = await runRetentionSweep({ now: NOW }, makeDeps(["org-1"]));

    expect(scope.repos.documents.listExpiredDraftsBefore).toHaveBeenCalledWith(
      new Date(NOW.getTime() - DRAFT_MAX_AGE_HOURS * HOUR),
    );
    // State-guarded purge (not the forensic hard-delete path).
    expect(scope.repos.documents.purgeDraft).toHaveBeenCalledWith("draft-1");
    expect(hardDeleteDocumentMock).not.toHaveBeenCalled();
    expect(summary.draftsPurged).toBe(1);
  });

  it("treats a not_found race as an idempotent no-op (doesn't count it)", async () => {
    const scope = makeScope("org-1");
    scope.repos.documents.listSoftDeletedBefore.mockResolvedValue([
      { id: "gone" },
      { id: "alive" },
    ]);
    systemScopeMock.mockReturnValue(scope);
    hardDeleteDocumentMock
      .mockRejectedValueOnce(new DeletionError("not_found"))
      .mockResolvedValueOnce(undefined);

    const summary = await runRetentionSweep({ now: NOW }, makeDeps(["org-1"]));

    // Both attempted, only the surviving one counted.
    expect(hardDeleteDocumentMock).toHaveBeenCalledTimes(2);
    expect(summary.documentsHardDeleted).toBe(1);
  });

  it("isolates a failing org: counts orgsFailed and keeps sweeping the rest", async () => {
    const failing = makeScope("org-1");
    failing.repos.documents.listSoftDeletedBefore.mockResolvedValue([
      { id: "boom" },
    ]);
    const healthy = makeScope("org-2");
    healthy.repos.documents.listExpiredDraftsBefore.mockResolvedValue([
      { id: "d" },
    ]);
    const scopes = new Map([
      ["org-1", failing],
      ["org-2", healthy],
    ]);
    systemScopeMock.mockImplementation((orgId: string) => scopes.get(orgId));
    // org-1's hard-delete throws a non-not_found error → whole org skipped.
    hardDeleteDocumentMock.mockRejectedValue(new Error("db exploded"));

    const summary = await runRetentionSweep(
      { now: NOW },
      makeDeps(["org-1", "org-2"]),
    );

    // Failure is contained: org-1 counted as failed, org-2 still swept.
    expect(summary.orgsFailed).toBe(1);
    expect(summary.orgsSwept).toBe(1);
    expect(healthy.repos.documents.purgeDraft).toHaveBeenCalledWith("d");
    expect(summary.draftsPurged).toBe(1);
  });

  it("doesn't count an opportunity whose delete lost a race", async () => {
    const scope = makeScope("org-1");
    scope.repos.opportunities.listArchivedBefore.mockResolvedValue([
      { id: "opp-1" },
    ]);
    scope.repos.opportunities.hardDelete.mockResolvedValue(null);
    systemScopeMock.mockReturnValue(scope);

    const summary = await runRetentionSweep({ now: NOW }, makeDeps(["org-1"]));
    expect(summary.opportunitiesHardDeleted).toBe(0);
  });

  it("scopes once per org and aggregates across orgs", async () => {
    const scopes = new Map([
      ["org-1", makeScope("org-1")],
      ["org-2", makeScope("org-2")],
    ]);
    scopes
      .get("org-1")!
      .repos.documents.listSoftDeletedBefore.mockResolvedValue([{ id: "a" }]);
    scopes
      .get("org-2")!
      .repos.documents.listExpiredDraftsBefore.mockResolvedValue([{ id: "d" }]);
    systemScopeMock.mockImplementation((orgId: string) => scopes.get(orgId));

    const summary = await runRetentionSweep(
      { now: NOW },
      makeDeps(["org-1", "org-2"]),
    );

    expect(systemScopeMock).toHaveBeenCalledTimes(2);
    expect(systemScopeMock).toHaveBeenCalledWith("org-1", expect.anything(), {
      reason: "retention_sweep",
    });
    expect(summary).toEqual({
      orgsSwept: 2,
      orgsFailed: 0,
      documentsHardDeleted: 1,
      opportunitiesHardDeleted: 0,
      draftsPurged: 1,
    });
  });

  it("is a no-op with zero orgs", async () => {
    const summary = await runRetentionSweep({ now: NOW }, makeDeps([]));
    expect(systemScopeMock).not.toHaveBeenCalled();
    expect(summary).toEqual({
      orgsSwept: 0,
      orgsFailed: 0,
      documentsHardDeleted: 0,
      opportunitiesHardDeleted: 0,
      draftsPurged: 0,
    });
  });

  it("defaults the clock to now when none supplied", async () => {
    systemScopeMock.mockReturnValue(makeScope("org-1"));
    await runRetentionSweep({}, makeDeps(["org-1"]));
    // No throw + the eligibility read got a Date argument.
    const scope = systemScopeMock.mock.results[0]?.value;
    expect(
      scope.repos.documents.listSoftDeletedBefore.mock.calls[0][0],
    ).toBeInstanceOf(Date);
  });
});
