// Unit tests for the document download + version-history application
// functions. Mocks `DocumentRepo` / `DocumentVersionRepo` / `OpportunityRepo`
// / `S3DocumentStore` / `AuditRepo` via `vi.fn()`, same pattern as
// `upload.test.ts` / `opportunities.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditRepo } from "../../../infrastructure/db/auditRepo";
import type {
  DocumentRepo,
  DocumentWithCurrentVersion,
} from "../../../infrastructure/db/documentRepo";
import type { DocumentVersionRepo } from "../../../infrastructure/db/documentVersionRepo";
import type { OpportunityRepo } from "../../../infrastructure/db/opportunityRepo";
import type { S3DocumentStore } from "../../../infrastructure/s3/client";
import type {
  Document,
  DocumentVersion,
  Opportunity,
} from "@ai-data-room/api-utils/schemas/rooms";

import {
  DOWNLOAD_URL_TTL_SECONDS,
  DownloadError,
  getDocument,
  listVersions,
  presignDocumentDownload,
} from "../download";

const NOW = new Date("2026-07-16T10:00:00Z");
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OPPORTUNITY_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const FOREIGN_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const AUDIT_CTX = {
  sourceIp: "203.0.113.5",
  userAgent: "test/1.0",
} as const;

function makeVersion(
  overrides: Partial<DocumentVersion> = {},
): DocumentVersion {
  return {
    id: VERSION_ID,
    documentId: DOCUMENT_ID,
    orgId: ORG_ID,
    versionNumber: 2,
    originalFilename: "Term Sheet.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    sha256: "a".repeat(64),
    s3Key: `orgs/${ORG_ID}/documents/${DOCUMENT_ID}/${VERSION_ID}`,
    s3VersionId: "s3-ver-2",
    uploadedBy: ACTOR_ID,
    uploadedAt: NOW,
    ...overrides,
  };
}

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: DOCUMENT_ID,
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
  };
}

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
  documents: DocumentRepo;
  docGetWithCurrentVersion: ReturnType<typeof vi.fn>;
  docFindById: ReturnType<typeof vi.fn>;
  documentVersions: DocumentVersionRepo;
  versionFindById: ReturnType<typeof vi.fn>;
  versionListByDocument: ReturnType<typeof vi.fn>;
  opportunities: OpportunityRepo;
  oppFindById: ReturnType<typeof vi.fn>;
  store: S3DocumentStore;
  presignDownloadUrl: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const docGetWithCurrentVersion = vi.fn();
  const docFindById = vi.fn();
  const documents = {
    getWithCurrentVersion: docGetWithCurrentVersion,
    findById: docFindById,
    scopeOrgId: ORG_ID,
  } as unknown as DocumentRepo;

  const versionFindById = vi.fn();
  const versionListByDocument = vi.fn();
  const documentVersions = {
    findById: versionFindById,
    listByDocument: versionListByDocument,
  } as unknown as DocumentVersionRepo;

  const oppFindById = vi.fn();
  const opportunities = {
    findById: oppFindById,
  } as unknown as OpportunityRepo;

  const presignDownloadUrl = vi
    .fn()
    .mockResolvedValue("https://s3.example/signed");
  const store = {
    presignDownloadUrl,
  } as unknown as S3DocumentStore;

  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  return {
    documents,
    docGetWithCurrentVersion,
    docFindById,
    documentVersions,
    versionFindById,
    versionListByDocument,
    opportunities,
    oppFindById,
    store,
    presignDownloadUrl,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

describe("presignDocumentDownload", () => {
  it("passes the version's s3Key, s3VersionId, and the default TTL", async () => {
    const store = { presignDownloadUrl: vi.fn().mockResolvedValue("url") };

    await presignDocumentDownload(
      store as unknown as S3DocumentStore,
      makeVersion(),
    );

    expect(store.presignDownloadUrl).toHaveBeenCalledWith(
      `orgs/${ORG_ID}/documents/${DOCUMENT_ID}/${VERSION_ID}`,
      { versionId: "s3-ver-2", ttlSeconds: DOWNLOAD_URL_TTL_SECONDS },
    );
  });

  it("omits versionId when the version has no s3VersionId", async () => {
    const store = { presignDownloadUrl: vi.fn().mockResolvedValue("url") };

    await presignDocumentDownload(
      store as unknown as S3DocumentStore,
      makeVersion({ s3VersionId: null }),
      120,
    );

    expect(store.presignDownloadUrl).toHaveBeenCalledWith(expect.any(String), {
      versionId: undefined,
      ttlSeconds: 120,
    });
  });
});

describe("getDocument", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("serves the current version, presigns with TTL 300, and audits file_downloaded", async () => {
    const version = makeVersion();
    deps.docGetWithCurrentVersion.mockResolvedValue({
      document: makeDocument(),
      currentVersion: version,
    } satisfies DocumentWithCurrentVersion);

    const result = await getDocument(
      {
        documentId: DOCUMENT_ID,
        actorUserId: ACTOR_ID,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(deps.presignDownloadUrl).toHaveBeenCalledWith(version.s3Key, {
      versionId: version.s3VersionId,
      ttlSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });
    expect(DOWNLOAD_URL_TTL_SECONDS).toBe(300);
    expect(result.downloadUrl).toBe("https://s3.example/signed");
    expect(result.document.currentVersion.id).toBe(VERSION_ID);
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "file_downloaded",
        outcome: "success",
        actorUserId: ACTOR_ID,
        orgId: ORG_ID,
        metadata: expect.objectContaining({
          documentId: DOCUMENT_ID,
          versionId: VERSION_ID,
          versionNumber: 2,
        }),
      }),
    );
  });

  it("serves a specific requested version when versionId is given", async () => {
    const currentVersion = makeVersion();
    const olderVersion = makeVersion({
      id: OTHER_VERSION_ID,
      versionNumber: 1,
      s3VersionId: "s3-ver-1",
    });
    deps.docGetWithCurrentVersion.mockResolvedValue({
      document: makeDocument(),
      currentVersion,
    } satisfies DocumentWithCurrentVersion);
    deps.versionFindById.mockResolvedValue(olderVersion);

    const result = await getDocument(
      {
        documentId: DOCUMENT_ID,
        versionId: OTHER_VERSION_ID,
        actorUserId: ACTOR_ID,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(deps.presignDownloadUrl).toHaveBeenCalledWith(olderVersion.s3Key, {
      versionId: "s3-ver-1",
      ttlSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });
    // The DTO still shows the CURRENT version, not the one served.
    expect(result.document.currentVersion.id).toBe(VERSION_ID);
    expect(deps.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          versionId: OTHER_VERSION_ID,
          versionNumber: 1,
        }),
      }),
    );
  });

  it("throws version_not_found when the requested versionId is unknown", async () => {
    deps.docGetWithCurrentVersion.mockResolvedValue({
      document: makeDocument(),
      currentVersion: makeVersion(),
    } satisfies DocumentWithCurrentVersion);
    deps.versionFindById.mockResolvedValue(null);

    await expect(
      getDocument(
        {
          documentId: DOCUMENT_ID,
          versionId: FOREIGN_VERSION_ID,
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      ),
    ).rejects.toThrow(/version_not_found/);

    expect(deps.presignDownloadUrl).not.toHaveBeenCalled();
    expect(deps.auditWrite).not.toHaveBeenCalled();
  });

  it("throws version_not_found when versionId belongs to a different document", async () => {
    deps.docGetWithCurrentVersion.mockResolvedValue({
      document: makeDocument(),
      currentVersion: makeVersion(),
    } satisfies DocumentWithCurrentVersion);
    deps.versionFindById.mockResolvedValue(
      makeVersion({ id: FOREIGN_VERSION_ID, documentId: "some-other-doc" }),
    );

    await expect(
      getDocument(
        {
          documentId: DOCUMENT_ID,
          versionId: FOREIGN_VERSION_ID,
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      ),
    ).rejects.toThrow(DownloadError);
  });

  it("throws not_found when the document is missing", async () => {
    deps.docGetWithCurrentVersion.mockResolvedValue(null);

    await expect(
      getDocument(
        { documentId: DOCUMENT_ID, actorUserId: ACTOR_ID, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(/not_found/);

    expect(deps.auditWrite).not.toHaveBeenCalled();
  });

  it("throws not_found when the document is soft-deleted", async () => {
    deps.docGetWithCurrentVersion.mockResolvedValue({
      document: makeDocument({ state: "soft_deleted", softDeletedAt: NOW }),
      currentVersion: makeVersion(),
    } satisfies DocumentWithCurrentVersion);

    await expect(
      getDocument(
        { documentId: DOCUMENT_ID, actorUserId: ACTOR_ID, audit: AUDIT_CTX },
        deps,
      ),
    ).rejects.toThrow(DownloadError);

    expect(deps.presignDownloadUrl).not.toHaveBeenCalled();
  });

  it("resolves the opportunity slug for an opportunity-folder document", async () => {
    const doc = makeDocument({
      folderKind: "opportunity",
      canonicalFolder: null,
      opportunityId: OPPORTUNITY_ID,
    });
    deps.docGetWithCurrentVersion.mockResolvedValue({
      document: doc,
      currentVersion: makeVersion(),
    } satisfies DocumentWithCurrentVersion);
    deps.oppFindById.mockResolvedValue(makeOpportunity());

    const result = await getDocument(
      { documentId: DOCUMENT_ID, actorUserId: ACTOR_ID, audit: AUDIT_CTX },
      deps,
    );

    expect(deps.oppFindById).toHaveBeenCalledWith(OPPORTUNITY_ID);
    expect(result.document.folder).toEqual({
      kind: "opportunity",
      opportunityId: OPPORTUNITY_ID,
      slug: "Vendor_A",
    });
  });
});

describe("listVersions", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the mapped version history for an active document", async () => {
    deps.docFindById.mockResolvedValue(makeDocument());
    const v1 = makeVersion({ id: OTHER_VERSION_ID, versionNumber: 1 });
    const v2 = makeVersion({ versionNumber: 2 });
    deps.versionListByDocument.mockResolvedValue([v1, v2]);

    const result = await listVersions({ documentId: DOCUMENT_ID }, deps);

    expect(deps.versionListByDocument).toHaveBeenCalledWith(DOCUMENT_ID);
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(result[0]).not.toHaveProperty("s3Key");
  });

  it("throws not_found when the document is missing", async () => {
    deps.docFindById.mockResolvedValue(null);

    await expect(
      listVersions({ documentId: DOCUMENT_ID }, deps),
    ).rejects.toThrow(/not_found/);

    expect(deps.versionListByDocument).not.toHaveBeenCalled();
  });

  it("throws not_found when the document is soft-deleted", async () => {
    deps.docFindById.mockResolvedValue(
      makeDocument({ state: "soft_deleted", softDeletedAt: NOW }),
    );

    await expect(
      listVersions({ documentId: DOCUMENT_ID }, deps),
    ).rejects.toThrow(DownloadError);
  });
});
