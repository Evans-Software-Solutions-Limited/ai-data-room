// Unit tests for the room/folder listing application functions.
//
// Mocks `DocumentRepo` / `OpportunityRepo` / `AuditRepo` via `vi.fn()`,
// same pattern as `opportunities.test.ts` — real `recordAuditEvent`/
// `safeAudit` against the mocked `AuditRepo`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditRepo } from "../../../infrastructure/db/auditRepo";
import type {
  DocumentRepo,
  DocumentWithCurrentVersion,
} from "../../../infrastructure/db/documentRepo";
import type { OpportunityRepo } from "../../../infrastructure/db/opportunityRepo";
import type {
  Document,
  DocumentVersion,
  Opportunity,
} from "@ai-data-room/api-utils/schemas/rooms";

import { getRoom, ListingError, listFolderContents } from "../listing";

const NOW = new Date("2026-07-16T10:00:00Z");
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const OPPORTUNITY_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
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
    versionNumber: 1,
    originalFilename: "Term Sheet.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    sha256: "a".repeat(64),
    s3Key: `orgs/${ORG_ID}/documents/${DOCUMENT_ID}/${VERSION_ID}`,
    s3VersionId: "s3-ver-1",
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
  docListByCanonicalFolderWithVersion: ReturnType<typeof vi.fn>;
  docListByOpportunityWithVersion: ReturnType<typeof vi.fn>;
  opportunities: OpportunityRepo;
  oppFindById: ReturnType<typeof vi.fn>;
  oppListActive: ReturnType<typeof vi.fn>;
  auditRepo: AuditRepo;
  auditWrite: ReturnType<typeof vi.fn>;
}

function makeDeps(): MockDeps {
  const docListByCanonicalFolderWithVersion = vi.fn();
  const docListByOpportunityWithVersion = vi.fn();
  const documents = {
    listByCanonicalFolderWithVersion: docListByCanonicalFolderWithVersion,
    listByOpportunityWithVersion: docListByOpportunityWithVersion,
    scopeOrgId: ORG_ID,
  } as unknown as DocumentRepo;

  const oppFindById = vi.fn();
  const oppListActive = vi.fn();
  const opportunities = {
    findById: oppFindById,
    listActive: oppListActive,
  } as unknown as OpportunityRepo;

  const auditWrite = vi
    .fn()
    .mockResolvedValue({ id: "audit_id", occurredAt: NOW });

  return {
    documents,
    docListByCanonicalFolderWithVersion,
    docListByOpportunityWithVersion,
    opportunities,
    oppFindById,
    oppListActive,
    auditRepo: { write: auditWrite } as unknown as AuditRepo,
    auditWrite,
  };
}

describe("getRoom", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the seven canonical folders plus mapped active opportunities", async () => {
    deps.oppListActive.mockResolvedValue([makeOpportunity()]);

    const result = await getRoom({ opportunities: deps.opportunities });

    expect(result.folders).toHaveLength(7);
    expect(result.folders).toContain("02_Financials");
    expect(result.opportunities).toEqual([
      {
        id: OPPORTUNITY_ID,
        slug: "Vendor_A",
        name: "Vendor A",
        status: "active",
        createdAt: "2026-07-16T10:00:00.000Z",
      },
    ]);
  });

  it("emits no audit event (read-only)", async () => {
    deps.oppListActive.mockResolvedValue([]);
    await getRoom({ opportunities: deps.opportunities });
    expect(deps.auditWrite).not.toHaveBeenCalled();
  });
});

describe("listFolderContents", () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("canonical target", () => {
    it("maps rows to DocumentDTOs and audits folder_listed with count", async () => {
      const row: DocumentWithCurrentVersion = {
        document: makeDocument(),
        currentVersion: makeVersion(),
      };
      deps.docListByCanonicalFolderWithVersion.mockResolvedValue([row]);

      const result = await listFolderContents(
        {
          target: { kind: "canonical", folder: "02_Financials" },
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      );

      expect(deps.docListByCanonicalFolderWithVersion).toHaveBeenCalledWith(
        "02_Financials",
      );
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.folder).toEqual({
        kind: "canonical",
        folder: "02_Financials",
      });
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "folder_listed",
          outcome: "success",
          actorUserId: ACTOR_ID,
          orgId: ORG_ID,
          metadata: expect.objectContaining({
            folder: "02_Financials",
            count: 1,
          }),
        }),
      );
      expect(deps.oppFindById).not.toHaveBeenCalled();
    });

    it("returns an empty list and audits count 0", async () => {
      deps.docListByCanonicalFolderWithVersion.mockResolvedValue([]);

      const result = await listFolderContents(
        {
          target: { kind: "canonical", folder: "05_Legal" },
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      );

      expect(result.documents).toEqual([]);
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ folder: "05_Legal", count: 0 }),
        }),
      );
    });
  });

  describe("opportunity target", () => {
    it("throws folder_not_found when the opportunity is missing, no audit write", async () => {
      deps.oppFindById.mockResolvedValue(null);

      await expect(
        listFolderContents(
          {
            target: { kind: "opportunity", opportunityId: OPPORTUNITY_ID },
            actorUserId: ACTOR_ID,
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(ListingError);

      expect(deps.docListByOpportunityWithVersion).not.toHaveBeenCalled();
      expect(deps.auditWrite).not.toHaveBeenCalled();
    });

    it("throws folder_not_found when the opportunity is archived (FR6), no audit write", async () => {
      deps.oppFindById.mockResolvedValue(
        makeOpportunity({ status: "archived", archivedAt: NOW }),
      );

      await expect(
        listFolderContents(
          {
            target: { kind: "opportunity", opportunityId: OPPORTUNITY_ID },
            actorUserId: ACTOR_ID,
            audit: AUDIT_CTX,
          },
          deps,
        ),
      ).rejects.toThrow(/folder_not_found/);

      expect(deps.docListByOpportunityWithVersion).not.toHaveBeenCalled();
      expect(deps.auditWrite).not.toHaveBeenCalled();
    });

    it("lists an active opportunity's documents with the opp slug in the folder, and audits", async () => {
      deps.oppFindById.mockResolvedValue(makeOpportunity());
      const doc = makeDocument({
        folderKind: "opportunity",
        canonicalFolder: null,
        opportunityId: OPPORTUNITY_ID,
      });
      deps.docListByOpportunityWithVersion.mockResolvedValue([
        { document: doc, currentVersion: makeVersion() },
      ]);

      const result = await listFolderContents(
        {
          target: { kind: "opportunity", opportunityId: OPPORTUNITY_ID },
          actorUserId: ACTOR_ID,
          audit: AUDIT_CTX,
        },
        deps,
      );

      expect(deps.docListByOpportunityWithVersion).toHaveBeenCalledWith(
        OPPORTUNITY_ID,
      );
      expect(result.documents[0]?.folder).toEqual({
        kind: "opportunity",
        opportunityId: OPPORTUNITY_ID,
        slug: "Vendor_A",
      });
      expect(deps.auditWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "folder_listed",
          outcome: "success",
          metadata: expect.objectContaining({
            opportunityId: OPPORTUNITY_ID,
            count: 1,
          }),
        }),
      );
    });
  });
});
