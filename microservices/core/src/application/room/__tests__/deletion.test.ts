// Unit tests for the deletion application functions (T-009).
//
// Mocks the scoped repos + the S3 store + db.transaction (same pattern as
// upload.test.ts). Covers each transition, its audit event, the failure
// branches, and the 30-day restore-window boundary with an injected clock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditRepo } from "../../../infrastructure/db/auditRepo";
import type { DocumentRepo } from "../../../infrastructure/db/documentRepo";
import type { DocumentDeletionRepo } from "../../../infrastructure/db/documentDeletionRepo";
import type { DocumentVersionRepo } from "../../../infrastructure/db/documentVersionRepo";
import type { S3DocumentStore } from "../../../infrastructure/s3/client";
import type { Db } from "@ai-data-room/db";
import type {
  Document,
  DocumentVersion,
} from "@ai-data-room/api-utils/schemas/rooms";

import {
  DeletionError,
  hardDeleteDocument,
  restoreDocument,
  softDeleteDocument,
  SOFT_DELETE_RETENTION_DAYS,
} from "../deletion";

const NOW = new Date("2026-07-16T10:00:00Z");
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const AUDIT_CTX = { sourceIp: "203.0.113.5", userAgent: "test/1.0" } as const;
const TX_SENTINEL = Symbol("tx");
const RETENTION_MS = SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    orgId: ORG_ID,
    folderKind: "canonical",
    canonicalFolder: "02_Financials",
    opportunityId: null,
    displayName: "Term Sheet.pdf",
    currentVersionId: VERSION_ID,
    state: "active",
    softDeletedAt: null,
    createdBy: ACTOR_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Document;
}

function makeVersion(
  overrides: Partial<DocumentVersion> = {},
): DocumentVersion {
  return {
    id: VERSION_ID,
    documentId: DOC_ID,
    orgId: ORG_ID,
    versionNumber: 1,
    originalFilename: "Term Sheet.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    sha256: "a".repeat(64),
    s3Key: `orgs/${ORG_ID}/documents/${DOC_ID}/${VERSION_ID}`,
    s3VersionId: "s3v1",
    uploadedBy: ACTOR_ID,
    uploadedAt: NOW,
    ...overrides,
  } as DocumentVersion;
}

// ─── softDeleteDocument ────────────────────────────────────────────────────

describe("softDeleteDocument", () => {
  let findById: ReturnType<typeof vi.fn>;
  let softDelete: ReturnType<typeof vi.fn>;
  let auditWrite: ReturnType<typeof vi.fn>;
  let deps: { documents: DocumentRepo; auditRepo: AuditRepo };

  beforeEach(() => {
    findById = vi.fn().mockResolvedValue(makeDoc({ state: "active" }));
    softDelete = vi
      .fn()
      .mockResolvedValue(
        makeDoc({ state: "soft_deleted", softDeletedAt: NOW }),
      );
    auditWrite = vi.fn().mockResolvedValue({ id: "audit", occurredAt: NOW });
    deps = {
      documents: {
        findById,
        softDelete,
        scopeOrgId: ORG_ID,
      } as unknown as DocumentRepo,
      auditRepo: { write: auditWrite } as unknown as AuditRepo,
    };
  });

  afterEach(() => vi.clearAllMocks());

  const input = {
    documentId: DOC_ID,
    actorUserId: ACTOR_ID,
    audit: AUDIT_CTX,
    now: NOW,
  };

  it("soft-deletes an active document and emits file_soft_deleted", async () => {
    await softDeleteDocument(input, deps);

    expect(softDelete).toHaveBeenCalledWith(DOC_ID, NOW);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "file_soft_deleted",
        outcome: "success",
        orgId: ORG_ID,
        metadata: { documentId: DOC_ID },
      }),
    );
  });

  it("defaults the clock to now when no timestamp is supplied", async () => {
    await softDeleteDocument(
      { documentId: DOC_ID, actorUserId: ACTOR_ID, audit: AUDIT_CTX },
      deps,
    );
    expect(softDelete).toHaveBeenCalledWith(DOC_ID, expect.any(Date));
  });

  it("throws not_found (no state change) when the document is unknown", async () => {
    findById.mockResolvedValue(null);
    await expect(softDeleteDocument(input, deps)).rejects.toMatchObject({
      reason: "not_found",
    });
    expect(softDelete).not.toHaveBeenCalled();
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failure" }),
    );
  });

  it("throws invalid_state when the document is not active", async () => {
    findById.mockResolvedValue(makeDoc({ state: "soft_deleted" }));
    await expect(softDeleteDocument(input, deps)).rejects.toThrow(
      DeletionError,
    );
    await expect(softDeleteDocument(input, deps)).rejects.toMatchObject({
      reason: "invalid_state",
    });
    expect(softDelete).not.toHaveBeenCalled();
  });

  it("throws invalid_state when the compare-and-set loses a race", async () => {
    softDelete.mockResolvedValue(null);
    await expect(softDeleteDocument(input, deps)).rejects.toMatchObject({
      reason: "invalid_state",
    });
    const successAudits = auditWrite.mock.calls.filter(
      ([e]) => e.outcome === "success",
    );
    expect(successAudits).toHaveLength(0);
  });
});

// ─── restoreDocument ───────────────────────────────────────────────────────

describe("restoreDocument", () => {
  let findById: ReturnType<typeof vi.fn>;
  let restore: ReturnType<typeof vi.fn>;
  let auditWrite: ReturnType<typeof vi.fn>;
  let deps: { documents: DocumentRepo; auditRepo: AuditRepo };

  // A document soft-deleted `elapsedMs` before NOW.
  function softDeletedAgo(elapsedMs: number): Document {
    return makeDoc({
      state: "soft_deleted",
      softDeletedAt: new Date(NOW.getTime() - elapsedMs),
    });
  }

  beforeEach(() => {
    findById = vi.fn().mockResolvedValue(softDeletedAgo(0));
    restore = vi.fn().mockResolvedValue(makeDoc({ state: "active" }));
    auditWrite = vi.fn().mockResolvedValue({ id: "audit", occurredAt: NOW });
    deps = {
      documents: {
        findById,
        restore,
        scopeOrgId: ORG_ID,
      } as unknown as DocumentRepo,
      auditRepo: { write: auditWrite } as unknown as AuditRepo,
    };
  });

  afterEach(() => vi.clearAllMocks());

  const input = {
    documentId: DOC_ID,
    actorUserId: ACTOR_ID,
    audit: AUDIT_CTX,
    now: NOW,
  };

  it("restores a soft-deleted document within the window and emits file_restored", async () => {
    findById.mockResolvedValue(softDeletedAgo(RETENTION_MS - 1000));
    await restoreDocument(input, deps);

    expect(restore).toHaveBeenCalledWith(DOC_ID);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "file_restored",
        outcome: "success",
        orgId: ORG_ID,
        metadata: { documentId: DOC_ID },
      }),
    );
  });

  it("defaults the clock to now when no timestamp is supplied", async () => {
    // Soft-deleted moments ago (well within the window under a real clock).
    findById.mockResolvedValue(softDeletedAgo(1000));
    await restoreDocument(
      { documentId: DOC_ID, actorUserId: ACTOR_ID, audit: AUDIT_CTX },
      deps,
    );
    expect(restore).toHaveBeenCalledWith(DOC_ID);
  });

  it("allows restore at exactly the 30-day boundary (elapsed == window)", async () => {
    findById.mockResolvedValue(softDeletedAgo(RETENTION_MS));
    await restoreDocument(input, deps);
    expect(restore).toHaveBeenCalledWith(DOC_ID);
  });

  it("throws retention_expired just past the 30-day boundary", async () => {
    findById.mockResolvedValue(softDeletedAgo(RETENTION_MS + 1));
    await expect(restoreDocument(input, deps)).rejects.toMatchObject({
      reason: "retention_expired",
    });
    expect(restore).not.toHaveBeenCalled();
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "file_restored",
        outcome: "failure",
        metadata: { documentId: DOC_ID, reason: "retention_expired" },
      }),
    );
  });

  it("throws not_found when the document is unknown", async () => {
    findById.mockResolvedValue(null);
    await expect(restoreDocument(input, deps)).rejects.toMatchObject({
      reason: "not_found",
    });
    expect(restore).not.toHaveBeenCalled();
  });

  it("throws invalid_state when the document is not soft-deleted", async () => {
    findById.mockResolvedValue(makeDoc({ state: "active" }));
    await expect(restoreDocument(input, deps)).rejects.toMatchObject({
      reason: "invalid_state",
    });
    expect(restore).not.toHaveBeenCalled();
  });

  it("allows restore when soft_deleted_at is missing (fail-open, can't prove expiry)", async () => {
    findById.mockResolvedValue(
      makeDoc({ state: "soft_deleted", softDeletedAt: null }),
    );
    await restoreDocument(input, deps);
    expect(restore).toHaveBeenCalledWith(DOC_ID);
  });

  it("throws invalid_state when the compare-and-set loses a race", async () => {
    restore.mockResolvedValue(null);
    await expect(restoreDocument(input, deps)).rejects.toMatchObject({
      reason: "invalid_state",
    });
    const successAudits = auditWrite.mock.calls.filter(
      ([e]) => e.outcome === "success",
    );
    expect(successAudits).toHaveLength(0);
  });
});

// ─── hardDeleteDocument ────────────────────────────────────────────────────

describe("hardDeleteDocument", () => {
  let findById: ReturnType<typeof vi.fn>;
  let hardDelete: ReturnType<typeof vi.fn>;
  let docWithTx: ReturnType<typeof vi.fn>;
  let listByDocument: ReturnType<typeof vi.fn>;
  let dvWithTx: ReturnType<typeof vi.fn>;
  let deletionCreate: ReturnType<typeof vi.fn>;
  let ddWithTx: ReturnType<typeof vi.fn>;
  let tagObject: ReturnType<typeof vi.fn>;
  let auditWrite: ReturnType<typeof vi.fn>;
  let dbTransaction: ReturnType<typeof vi.fn>;
  let deps: {
    db: Db;
    documents: DocumentRepo;
    documentVersions: DocumentVersionRepo;
    documentDeletions: DocumentDeletionRepo;
    store: S3DocumentStore;
    auditRepo: AuditRepo;
  };

  const input = {
    documentId: DOC_ID,
    actorUserId: ACTOR_ID,
    audit: AUDIT_CTX,
  };

  beforeEach(() => {
    findById = vi.fn().mockResolvedValue(makeDoc({ state: "soft_deleted" }));
    hardDelete = vi.fn().mockResolvedValue(makeDoc({ state: "soft_deleted" }));
    docWithTx = vi.fn();
    listByDocument = vi.fn().mockResolvedValue([makeVersion()]);
    dvWithTx = vi.fn();
    deletionCreate = vi.fn().mockResolvedValue({ id: "del-1" });
    ddWithTx = vi.fn();
    tagObject = vi.fn().mockResolvedValue(undefined);
    auditWrite = vi.fn().mockResolvedValue({ id: "audit", occurredAt: NOW });
    dbTransaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(TX_SENTINEL),
    );

    const documents = {
      findById,
      hardDelete,
      withTx: docWithTx,
      scopeOrgId: ORG_ID,
    } as unknown as DocumentRepo;
    docWithTx.mockReturnValue(documents);

    const documentVersions = {
      listByDocument,
      withTx: dvWithTx,
    } as unknown as DocumentVersionRepo;
    dvWithTx.mockReturnValue(documentVersions);

    const documentDeletions = {
      create: deletionCreate,
      withTx: ddWithTx,
    } as unknown as DocumentDeletionRepo;
    ddWithTx.mockReturnValue(documentDeletions);

    deps = {
      db: { transaction: dbTransaction } as unknown as Db,
      documents,
      documentVersions,
      documentDeletions,
      store: { tagObject } as unknown as S3DocumentStore,
      auditRepo: { write: auditWrite } as unknown as AuditRepo,
    };
  });

  afterEach(() => vi.clearAllMocks());

  it("writes a deletion record, deletes the doc, tags each version object, audits", async () => {
    await hardDeleteDocument(input, deps);

    expect(listByDocument).toHaveBeenCalledWith(DOC_ID);
    expect(deletionCreate).toHaveBeenCalledWith({
      documentId: DOC_ID,
      softDeletedBy: ACTOR_ID,
    });
    expect(hardDelete).toHaveBeenCalledWith(DOC_ID);
    // Repos operate inside the tx.
    expect(dvWithTx).toHaveBeenCalledWith(TX_SENTINEL);
    expect(ddWithTx).toHaveBeenCalledWith(TX_SENTINEL);
    expect(docWithTx).toHaveBeenCalledWith(TX_SENTINEL);
    // Tag with the stored s3VersionId (present on this version).
    expect(tagObject).toHaveBeenCalledWith(
      `orgs/${ORG_ID}/documents/${DOC_ID}/${VERSION_ID}`,
      { state: "hard-deleted" },
      "s3v1",
    );
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "file_hard_deleted",
        outcome: "success",
        orgId: ORG_ID,
        metadata: { documentId: DOC_ID, versionsDeleted: 1 },
      }),
    );
  });

  it("tags every version, omitting VersionId when the object has none", async () => {
    listByDocument.mockResolvedValue([
      makeVersion({ id: "v1", s3Key: "k1", s3VersionId: null }),
      makeVersion({ id: "v2", s3Key: "k2", s3VersionId: "s3v2" }),
    ]);

    await hardDeleteDocument(input, deps);

    expect(tagObject).toHaveBeenCalledWith(
      "k1",
      { state: "hard-deleted" },
      undefined,
    );
    expect(tagObject).toHaveBeenCalledWith(
      "k2",
      { state: "hard-deleted" },
      "s3v2",
    );
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { documentId: DOC_ID, versionsDeleted: 2 },
      }),
    );
  });

  it("throws not_found (no tx) when the document is unknown", async () => {
    findById.mockResolvedValue(null);
    await expect(hardDeleteDocument(input, deps)).rejects.toMatchObject({
      reason: "not_found",
    });
    expect(dbTransaction).not.toHaveBeenCalled();
    expect(tagObject).not.toHaveBeenCalled();
  });

  it("throws not_found when the doc is deleted out from under the tx (failure audit, no S3 tagging, no success audit)", async () => {
    hardDelete.mockResolvedValue(null);
    await expect(hardDeleteDocument(input, deps)).rejects.toMatchObject({
      reason: "not_found",
    });
    expect(tagObject).not.toHaveBeenCalled();
    const successAudits = auditWrite.mock.calls.filter(
      ([e]) => e.outcome === "success",
    );
    expect(successAudits).toHaveLength(0);
    // FR19: the lost-race outcome is still audited (matches soft-delete /
    // restore), so the most destructive op is never silent.
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "file_hard_deleted",
        outcome: "failure",
        metadata: { documentId: DOC_ID, reason: "not_found" },
      }),
    );
  });

  it("still succeeds (DB committed) when an S3 tag call fails — leak, not a failed delete", async () => {
    tagObject.mockRejectedValue(new Error("s3 down"));
    await expect(hardDeleteDocument(input, deps)).resolves.toBeUndefined();
    expect(hardDelete).toHaveBeenCalledWith(DOC_ID);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "file_hard_deleted",
        outcome: "success",
      }),
    );
  });
});
