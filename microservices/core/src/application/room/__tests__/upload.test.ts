// Unit tests for the upload application functions (T-007).
//
// Mocks the scoped repos + the S3 store + db.transaction (same pattern as
// opportunities.test.ts). The version id minted inside `initiateUpload`
// is random, so we assert the S3 key is built FROM the returned
// versionId rather than pinning a literal.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditRepo } from "../../../infrastructure/db/auditRepo";
import type { DocumentRepo } from "../../../infrastructure/db/documentRepo";
import type { DocumentVersionRepo } from "../../../infrastructure/db/documentVersionRepo";
import type { OpportunityRepo } from "../../../infrastructure/db/opportunityRepo";
import type { S3DocumentStore } from "../../../infrastructure/s3/client";
import type { Db } from "@ai-data-room/db";
import {
  MAX_UPLOAD_BYTES,
  type Document,
} from "@ai-data-room/api-utils/schemas/rooms";

import {
  completeUpload,
  initiateUpload,
  UploadError,
  UPLOAD_PART_SIZE,
} from "../upload";

const NOW = new Date("2026-07-16T10:00:00Z");
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const DOC_ID = "44444444-4444-4444-8444-444444444444";
const OPP_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const AUDIT_CTX = { sourceIp: "203.0.113.5", userAgent: "test/1.0" } as const;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_SENTINEL = Symbol("tx");

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: DOC_ID,
    orgId: ORG_ID,
    folderKind: "canonical",
    canonicalFolder: "02_Financials",
    opportunityId: null,
    displayName: "Term Sheet.pdf",
    currentVersionId: null,
    state: "draft",
    softDeletedAt: null,
    createdBy: ACTOR_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Document;
}

// ─── initiateUpload ──────────────────────────────────────────────────────

describe("initiateUpload", () => {
  let findActiveByName: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let oppFindById: ReturnType<typeof vi.fn>;
  let createMultipartUpload: ReturnType<typeof vi.fn>;
  let presignPartUrls: ReturnType<typeof vi.fn>;
  let deps: {
    documents: DocumentRepo;
    opportunities: OpportunityRepo;
    store: S3DocumentStore;
  };

  beforeEach(() => {
    findActiveByName = vi.fn().mockResolvedValue(null);
    create = vi.fn().mockResolvedValue(makeDoc({ id: DOC_ID }));
    oppFindById = vi.fn();
    createMultipartUpload = vi.fn().mockResolvedValue("upload-1");
    presignPartUrls = vi
      .fn()
      .mockImplementation(
        (_key: string, _uploadId: string, partNumbers: number[]) =>
          Promise.resolve(
            partNumbers.map((n) => ({ partNumber: n, url: `https://s3/${n}` })),
          ),
      );
    deps = {
      documents: {
        findActiveByName,
        create,
        scopeOrgId: ORG_ID,
      } as unknown as DocumentRepo,
      opportunities: { findById: oppFindById } as unknown as OpportunityRepo,
      store: {
        createMultipartUpload,
        presignPartUrls,
      } as unknown as S3DocumentStore,
    };
  });

  afterEach(() => vi.clearAllMocks());

  it("creates a new draft document and returns a ticket keyed on the minted versionId", async () => {
    const result = await initiateUpload(
      {
        target: { kind: "canonical", folder: "02_Financials" },
        filename: "Term Sheet.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        actorUserId: ACTOR_ID,
      },
      deps,
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.documentId).toBe(DOC_ID);
    expect(result.versionId).toMatch(UUID_RE);
    expect(result.key).toBe(
      `orgs/${ORG_ID}/documents/${DOC_ID}/${result.versionId}`,
    );
    expect(result.uploadId).toBe("upload-1");
    expect(createMultipartUpload).toHaveBeenCalledWith(
      result.key,
      "application/pdf",
    );
  });

  it("presigns one part URL per 5MB chunk (ceil), min one", async () => {
    const cases: [number, number][] = [
      [1, 1],
      [UPLOAD_PART_SIZE, 1],
      [UPLOAD_PART_SIZE + 1, 2],
      [3 * UPLOAD_PART_SIZE, 3],
    ];
    for (const [sizeBytes, expectedParts] of cases) {
      vi.clearAllMocks();
      create.mockResolvedValue(makeDoc({ id: DOC_ID }));
      const result = await initiateUpload(
        {
          target: { kind: "canonical", folder: "02_Financials" },
          filename: "f.pdf",
          mimeType: "application/pdf",
          sizeBytes,
          actorUserId: ACTOR_ID,
        },
        deps,
      );
      expect(result.parts).toHaveLength(expectedParts);
    }
  });

  it("reuses the existing active document on a filename collision (FR13) — no new document", async () => {
    findActiveByName.mockResolvedValue(
      makeDoc({ id: DOC_ID, state: "active" }),
    );

    const result = await initiateUpload(
      {
        target: { kind: "canonical", folder: "02_Financials" },
        filename: "Term Sheet.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        actorUserId: ACTOR_ID,
      },
      deps,
    );

    expect(create).not.toHaveBeenCalled();
    expect(result.documentId).toBe(DOC_ID);
  });

  it("uploads into an active opportunity subroom", async () => {
    oppFindById.mockResolvedValue({ id: OPP_ID, status: "active" });

    await initiateUpload(
      {
        target: { kind: "opportunity", opportunityId: OPP_ID },
        filename: "NDA.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        actorUserId: ACTOR_ID,
      },
      deps,
    );

    expect(oppFindById).toHaveBeenCalledWith(OPP_ID);
    expect(findActiveByName).toHaveBeenCalledWith(
      expect.objectContaining({
        folderKind: "opportunity",
        opportunityId: OPP_ID,
      }),
    );
  });

  it("rejects an upload into a missing opportunity", async () => {
    oppFindById.mockResolvedValue(null);
    await expect(
      initiateUpload(
        {
          target: { kind: "opportunity", opportunityId: OPP_ID },
          filename: "NDA.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          actorUserId: ACTOR_ID,
        },
        deps,
      ),
    ).rejects.toThrow(/folder_not_found/);
    expect(createMultipartUpload).not.toHaveBeenCalled();
  });

  it("rejects an upload into an archived opportunity", async () => {
    oppFindById.mockResolvedValue({ id: OPP_ID, status: "archived" });
    await expect(
      initiateUpload(
        {
          target: { kind: "opportunity", opportunityId: OPP_ID },
          filename: "NDA.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          actorUserId: ACTOR_ID,
        },
        deps,
      ),
    ).rejects.toThrow(UploadError);
  });
});

// ─── completeUpload ──────────────────────────────────────────────────────

describe("completeUpload", () => {
  let findById: ReturnType<typeof vi.fn>;
  let markActive: ReturnType<typeof vi.fn>;
  let setCurrentVersion: ReturnType<typeof vi.fn>;
  let docWithTx: ReturnType<typeof vi.fn>;
  let versionCreate: ReturnType<typeof vi.fn>;
  let latestVersionNumber: ReturnType<typeof vi.fn>;
  let dvWithTx: ReturnType<typeof vi.fn>;
  let completeMultipartUpload: ReturnType<typeof vi.fn>;
  let headObject: ReturnType<typeof vi.fn>;
  let computeSha256: ReturnType<typeof vi.fn>;
  let deleteObject: ReturnType<typeof vi.fn>;
  let auditWrite: ReturnType<typeof vi.fn>;
  let dbTransaction: ReturnType<typeof vi.fn>;
  let deps: {
    db: Db;
    documents: DocumentRepo;
    documentVersions: DocumentVersionRepo;
    store: S3DocumentStore;
    auditRepo: AuditRepo;
  };

  const SHA = "a".repeat(64);

  function makeCompleteInput(overrides = {}) {
    return {
      uploadId: "upload-1",
      documentId: DOC_ID,
      versionId: VERSION_ID,
      parts: [{ partNumber: 1, eTag: "etag-1" }],
      actorUserId: ACTOR_ID,
      audit: AUDIT_CTX,
      ...overrides,
    };
  }

  beforeEach(() => {
    findById = vi.fn().mockResolvedValue(makeDoc({ state: "draft" }));
    markActive = vi.fn().mockResolvedValue(makeDoc({ state: "active" }));
    setCurrentVersion = vi.fn().mockResolvedValue(makeDoc({ state: "active" }));
    docWithTx = vi.fn();
    versionCreate = vi.fn().mockResolvedValue({ id: VERSION_ID });
    latestVersionNumber = vi.fn().mockResolvedValue(0);
    dvWithTx = vi.fn();
    completeMultipartUpload = vi.fn().mockResolvedValue({ versionId: "s3v1" });
    headObject = vi
      .fn()
      .mockResolvedValue({ sizeBytes: 2048, contentType: "application/pdf" });
    computeSha256 = vi.fn().mockResolvedValue(SHA);
    deleteObject = vi.fn().mockResolvedValue(undefined);
    auditWrite = vi.fn().mockResolvedValue({ id: "audit", occurredAt: NOW });
    dbTransaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(TX_SENTINEL),
    );

    const documents = {
      findById,
      markActive,
      setCurrentVersion,
      withTx: docWithTx,
      scopeOrgId: ORG_ID,
    } as unknown as DocumentRepo;
    docWithTx.mockReturnValue(documents);

    const documentVersions = {
      create: versionCreate,
      latestVersionNumber,
      withTx: dvWithTx,
    } as unknown as DocumentVersionRepo;
    dvWithTx.mockReturnValue(documentVersions);

    deps = {
      db: { transaction: dbTransaction } as unknown as Db,
      documents,
      documentVersions,
      store: {
        completeMultipartUpload,
        headObject,
        computeSha256,
        deleteObject,
      } as unknown as S3DocumentStore,
      auditRepo: { write: auditWrite } as unknown as AuditRepo,
    };
  });

  afterEach(() => vi.clearAllMocks());

  const KEY = `orgs/${ORG_ID}/documents/${DOC_ID}/${VERSION_ID}`;

  it("completes a first upload: version 1, markActive, file_uploaded audit", async () => {
    const result = await completeUpload(makeCompleteInput(), deps);

    expect(completeMultipartUpload).toHaveBeenCalledWith(KEY, "upload-1", [
      { partNumber: 1, eTag: "etag-1" },
    ]);
    expect(headObject).toHaveBeenCalledWith(KEY);
    expect(computeSha256).toHaveBeenCalledWith(KEY);
    expect(versionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: VERSION_ID,
        documentId: DOC_ID,
        versionNumber: 1,
        originalFilename: "Term Sheet.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        sha256: SHA,
        s3Key: KEY,
        s3VersionId: "s3v1",
        uploadedBy: ACTOR_ID,
      }),
    );
    expect(markActive).toHaveBeenCalledWith(DOC_ID, VERSION_ID);
    expect(setCurrentVersion).not.toHaveBeenCalled();
    expect(docWithTx).toHaveBeenCalledWith(TX_SENTINEL);
    expect(dvWithTx).toHaveBeenCalledWith(TX_SENTINEL);
    expect(result.versionNumber).toBe(1);
    expect(auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "file_uploaded",
        outcome: "success",
        orgId: ORG_ID,
        metadata: expect.objectContaining({
          documentId: DOC_ID,
          versionId: VERSION_ID,
          versionNumber: 1,
        }),
      }),
    );
  });

  it("adds a new version to an already-active document (FR13 collision path)", async () => {
    findById.mockResolvedValue(makeDoc({ state: "active" }));
    latestVersionNumber.mockResolvedValue(1);

    const result = await completeUpload(makeCompleteInput(), deps);

    expect(result.versionNumber).toBe(2);
    expect(setCurrentVersion).toHaveBeenCalledWith(DOC_ID, VERSION_ID);
    expect(markActive).not.toHaveBeenCalled();
  });

  it("rejects when the document is unknown, without touching S3", async () => {
    findById.mockResolvedValue(null);
    await expect(completeUpload(makeCompleteInput(), deps)).rejects.toThrow(
      /not_found/,
    );
    expect(completeMultipartUpload).not.toHaveBeenCalled();
  });

  it("rejects completing into a soft-deleted document", async () => {
    findById.mockResolvedValue(makeDoc({ state: "soft_deleted" }));
    await expect(completeUpload(makeCompleteInput(), deps)).rejects.toThrow(
      /invalid_state/,
    );
    expect(completeMultipartUpload).not.toHaveBeenCalled();
  });

  it("rejects and deletes the object when the completed size exceeds the cap (FR10)", async () => {
    headObject.mockResolvedValue({
      sizeBytes: MAX_UPLOAD_BYTES + 1,
      contentType: "application/pdf",
    });
    await expect(completeUpload(makeCompleteInput(), deps)).rejects.toThrow(
      /too_large/,
    );
    expect(deleteObject).toHaveBeenCalledWith(
      `orgs/${ORG_ID}/documents/${DOC_ID}/${VERSION_ID}`,
    );
    expect(computeSha256).not.toHaveBeenCalled();
    expect(versionCreate).not.toHaveBeenCalled();
  });

  it("translates a unique-violation in the tx into a retryable conflict", async () => {
    versionCreate.mockRejectedValue({ code: "23505" });
    await expect(completeUpload(makeCompleteInput(), deps)).rejects.toThrow(
      /conflict/,
    );
  });

  it("throws when the completed object has no content-type", async () => {
    headObject.mockResolvedValue({ sizeBytes: 2048, contentType: undefined });
    await expect(completeUpload(makeCompleteInput(), deps)).rejects.toThrow(
      /content-type/,
    );
    expect(versionCreate).not.toHaveBeenCalled();
  });

  it("throws activation_failed when the state transition matches no row", async () => {
    markActive.mockResolvedValue(null);
    await expect(completeUpload(makeCompleteInput(), deps)).rejects.toThrow(
      /activation_failed/,
    );
    const successAudits = auditWrite.mock.calls.filter(
      ([e]) => e.outcome === "success",
    );
    expect(successAudits).toHaveLength(0);
  });
});
