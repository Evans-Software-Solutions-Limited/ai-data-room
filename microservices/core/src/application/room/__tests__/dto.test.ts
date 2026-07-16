// Unit tests for the shared DTO mappers — room-and-folders (slice 2) /
// T-008. Pure functions, no mocking needed.

import { describe, expect, it } from "vitest";

import type {
  Document,
  DocumentVersion,
  Opportunity,
} from "@ai-data-room/api-utils/schemas/rooms";

import { toDocumentDTO, toDocumentVersionDTO, toOpportunityDTO } from "../dto";

const NOW = new Date("2026-07-16T10:00:00Z");
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const OPPORTUNITY_ID = "33333333-3333-4333-8333-333333333333";

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

describe("toDocumentVersionDTO", () => {
  it("omits s3Key and s3VersionId, and renders uploadedAt as ISO", () => {
    const dto = toDocumentVersionDTO(makeVersion());

    expect(dto).not.toHaveProperty("s3Key");
    expect(dto).not.toHaveProperty("s3VersionId");
    expect(dto).not.toHaveProperty("orgId");
    expect(dto).not.toHaveProperty("documentId");
    expect(dto.uploadedAt).toBe("2026-07-16T10:00:00.000Z");
    expect(dto).toEqual({
      id: VERSION_ID,
      versionNumber: 1,
      originalFilename: "Term Sheet.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      sha256: "a".repeat(64),
      uploadedBy: ACTOR_ID,
      uploadedAt: "2026-07-16T10:00:00.000Z",
    });
  });
});

describe("toOpportunityDTO", () => {
  it("renders createdAt as ISO and drops org-internal fields", () => {
    const dto = toOpportunityDTO(makeOpportunity());

    expect(dto).toEqual({
      id: OPPORTUNITY_ID,
      slug: "Vendor_A",
      name: "Vendor A",
      status: "active",
      createdAt: "2026-07-16T10:00:00.000Z",
    });
  });
});

describe("toDocumentDTO", () => {
  it("builds a canonical-folder DTO", () => {
    const dto = toDocumentDTO(makeDocument(), makeVersion());

    expect(dto.folder).toEqual({
      kind: "canonical",
      folder: "02_Financials",
    });
    expect(dto.id).toBe(DOCUMENT_ID);
    expect(dto.displayName).toBe("Term Sheet.pdf");
    expect(dto.state).toBe("active");
    expect(dto.currentVersion.id).toBe(VERSION_ID);
    expect(dto.createdAt).toBe("2026-07-16T10:00:00.000Z");
  });

  it("builds an opportunity-folder DTO with the caller-supplied slug", () => {
    const doc = makeDocument({
      folderKind: "opportunity",
      canonicalFolder: null,
      opportunityId: OPPORTUNITY_ID,
    });

    const dto = toDocumentDTO(doc, makeVersion(), "Vendor_A");

    expect(dto.folder).toEqual({
      kind: "opportunity",
      opportunityId: OPPORTUNITY_ID,
      slug: "Vendor_A",
    });
  });

  it("maps a soft-deleted document's state faithfully", () => {
    const dto = toDocumentDTO(
      makeDocument({ state: "soft_deleted" }),
      makeVersion(),
    );
    expect(dto.state).toBe("soft_deleted");
  });

  it("throws when currentVersion is null (data-integrity error)", () => {
    expect(() => toDocumentDTO(makeDocument(), null)).toThrow(
      /no current version/,
    );
  });

  it("throws for an opportunity-folder document with no slug (data-integrity error)", () => {
    const doc = makeDocument({
      folderKind: "opportunity",
      canonicalFolder: null,
      opportunityId: OPPORTUNITY_ID,
    });
    expect(() => toDocumentDTO(doc, makeVersion())).toThrow(
      /no slug was resolved/,
    );
  });
});
