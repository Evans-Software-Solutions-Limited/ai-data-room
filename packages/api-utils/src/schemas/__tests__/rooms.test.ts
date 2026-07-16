// Unit tests for the room-and-folders (slice 2) domain schemas — the
// canonical folder enum, opportunity/document aggregates, the
// FolderPath discriminated union, and the client-facing read DTOs.

import { describe, expect, it } from "vitest";

import {
  CANONICAL_FOLDERS,
  CanonicalFolderSchema,
  MimeTypeEnum,
  OpportunitySlugSchema,
  OpportunityStatusSchema,
  DocumentStateSchema,
  DocumentDTOSchema,
  DocumentSchema,
  DocumentVersionSchema,
  DocumentVersionDTOSchema,
  DocumentDeletionSchema,
  OpportunitySchema,
  OpportunityDTOSchema,
  FolderPathSchema,
  RoomDTOSchema,
  FolderListingDTOSchema,
  UploadTargetSchema,
  UploadInitiateSchema,
  UploadCompleteSchema,
  MAX_UPLOAD_BYTES,
} from "../rooms";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";

describe("CanonicalFolderSchema", () => {
  it("accepts all seven canonical folders", () => {
    for (const folder of CANONICAL_FOLDERS) {
      expect(CanonicalFolderSchema.parse(folder)).toBe(folder);
    }
  });

  it("rejects an unknown folder", () => {
    expect(() => CanonicalFolderSchema.parse("08_Other")).toThrow();
  });
});

describe("MimeTypeEnum", () => {
  it("accepts valid mime types", () => {
    expect(MimeTypeEnum.parse("application/pdf")).toBe("application/pdf");
    expect(MimeTypeEnum.parse("text/csv")).toBe("text/csv");
  });

  it("rejects an unsupported mime type", () => {
    expect(() => MimeTypeEnum.parse("application/zip")).toThrow();
  });
});

describe("OpportunitySlugSchema (FR4)", () => {
  it("accepts mixed-case and underscore/hyphen slugs", () => {
    expect(OpportunitySlugSchema.parse("Vendor_A")).toBe("Vendor_A");
    expect(OpportunitySlugSchema.parse("Vendor-B")).toBe("Vendor-B");
    expect(OpportunitySlugSchema.parse("AcmeCorp123")).toBe("AcmeCorp123");
  });

  it("rejects an empty slug", () => {
    expect(() => OpportunitySlugSchema.parse("")).toThrow();
  });

  it("rejects a slug longer than 64 characters", () => {
    expect(() => OpportunitySlugSchema.parse("a".repeat(65))).toThrow();
  });

  it("rejects a slug containing a space", () => {
    expect(() => OpportunitySlugSchema.parse("has space")).toThrow();
  });

  it("rejects a slug containing a slash", () => {
    expect(() => OpportunitySlugSchema.parse("bad/slash")).toThrow();
  });
});

describe("DocumentStateSchema", () => {
  it("includes draft (upload-pipeline reconciliation)", () => {
    expect(DocumentStateSchema.parse("draft")).toBe("draft");
    expect(DocumentStateSchema.parse("active")).toBe("active");
    expect(DocumentStateSchema.parse("soft_deleted")).toBe("soft_deleted");
    expect(DocumentStateSchema.parse("hard_deleted")).toBe("hard_deleted");
  });

  it("rejects an unknown state", () => {
    expect(() => DocumentStateSchema.parse("bogus")).toThrow();
  });
});

describe("DocumentDTOSchema.state (client-visible states only)", () => {
  const baseDTO = {
    id: DOCUMENT_ID,
    displayName: "Term Sheet.pdf",
    folder: { kind: "canonical" as const, folder: "02_Financials" as const },
    currentVersion: {
      id: VERSION_ID,
      versionNumber: 1,
      originalFilename: "Term Sheet.pdf",
      mimeType: "application/pdf" as const,
      sizeBytes: 1024,
      sha256: "abc123",
      uploadedBy: USER_ID,
      uploadedAt: "2026-07-16T00:00:00.000Z",
    },
    createdAt: "2026-07-16T00:00:00.000Z",
  };

  it("accepts active and soft_deleted", () => {
    expect(DocumentDTOSchema.parse({ ...baseDTO, state: "active" }).state).toBe(
      "active",
    );
    expect(
      DocumentDTOSchema.parse({ ...baseDTO, state: "soft_deleted" }).state,
    ).toBe("soft_deleted");
  });

  it("rejects draft", () => {
    expect(() =>
      DocumentDTOSchema.parse({ ...baseDTO, state: "draft" }),
    ).toThrow();
  });

  it("rejects hard_deleted", () => {
    expect(() =>
      DocumentDTOSchema.parse({ ...baseDTO, state: "hard_deleted" }),
    ).toThrow();
  });
});

describe("DocumentSchema.superRefine (folderKind XOR)", () => {
  const baseRow = {
    id: DOCUMENT_ID,
    orgId: ORG_ID,
    displayName: "Term Sheet.pdf",
    currentVersionId: VERSION_ID,
    state: "active" as const,
    softDeletedAt: null,
    createdBy: USER_ID,
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
  };

  it("passes for a valid canonical row", () => {
    expect(() =>
      DocumentSchema.parse({
        ...baseRow,
        folderKind: "canonical",
        canonicalFolder: "02_Financials",
        opportunityId: null,
      }),
    ).not.toThrow();
  });

  it("passes for a valid opportunity row", () => {
    expect(() =>
      DocumentSchema.parse({
        ...baseRow,
        folderKind: "opportunity",
        canonicalFolder: null,
        opportunityId: OPPORTUNITY_ID,
      }),
    ).not.toThrow();
  });

  it("fails when both canonicalFolder and opportunityId are set", () => {
    expect(() =>
      DocumentSchema.parse({
        ...baseRow,
        folderKind: "canonical",
        canonicalFolder: "02_Financials",
        opportunityId: OPPORTUNITY_ID,
      }),
    ).toThrow();
  });

  it("fails when both are null", () => {
    expect(() =>
      DocumentSchema.parse({
        ...baseRow,
        folderKind: "canonical",
        canonicalFolder: null,
        opportunityId: null,
      }),
    ).toThrow();
  });

  it("fails when folderKind='canonical' but only opportunityId is set", () => {
    expect(() =>
      DocumentSchema.parse({
        ...baseRow,
        folderKind: "canonical",
        canonicalFolder: null,
        opportunityId: OPPORTUNITY_ID,
      }),
    ).toThrow();
  });

  it("fails when folderKind='opportunity' but only canonicalFolder is set", () => {
    expect(() =>
      DocumentSchema.parse({
        ...baseRow,
        folderKind: "opportunity",
        canonicalFolder: "02_Financials",
        opportunityId: null,
      }),
    ).toThrow();
  });
});

describe("FolderPathSchema", () => {
  it("parses the canonical variant", () => {
    expect(
      FolderPathSchema.parse({
        kind: "canonical",
        folder: "01_Company_Overview",
      }),
    ).toEqual({ kind: "canonical", folder: "01_Company_Overview" });
  });

  it("parses the opportunity variant", () => {
    expect(
      FolderPathSchema.parse({
        kind: "opportunity",
        opportunityId: OPPORTUNITY_ID,
        slug: "Vendor_A",
      }),
    ).toEqual({
      kind: "opportunity",
      opportunityId: OPPORTUNITY_ID,
      slug: "Vendor_A",
    });
  });

  it("rejects a canonical variant missing folder", () => {
    expect(() => FolderPathSchema.parse({ kind: "canonical" })).toThrow();
  });
});

describe("OpportunitySchema", () => {
  const validOpportunity = {
    id: OPPORTUNITY_ID,
    orgId: ORG_ID,
    slug: "Vendor_A",
    name: "Vendor A",
    status: "active" as const,
    archivedAt: null,
    createdBy: USER_ID,
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z"),
  };

  it("parses a valid row", () => {
    expect(OpportunitySchema.parse(validOpportunity).slug).toBe("Vendor_A");
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      OpportunitySchema.parse({ ...validOpportunity, id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("OpportunityStatusSchema", () => {
  it("accepts active and archived", () => {
    expect(OpportunityStatusSchema.parse("active")).toBe("active");
    expect(OpportunityStatusSchema.parse("archived")).toBe("archived");
  });

  it("rejects an unknown status", () => {
    expect(() => OpportunityStatusSchema.parse("deleted")).toThrow();
  });
});

describe("DocumentVersionSchema", () => {
  const validVersion = {
    id: VERSION_ID,
    documentId: DOCUMENT_ID,
    orgId: ORG_ID,
    versionNumber: 1,
    originalFilename: "Term Sheet.pdf",
    mimeType: "application/pdf" as const,
    sizeBytes: 2048,
    sha256: "deadbeef",
    s3Key: "orgs/org-id/documents/doc-id/version-id",
    s3VersionId: null,
    uploadedBy: USER_ID,
    uploadedAt: new Date("2026-07-16T00:00:00.000Z"),
  };

  it("parses a valid row", () => {
    expect(DocumentVersionSchema.parse(validVersion).versionNumber).toBe(1);
  });

  it("rejects a non-positive versionNumber", () => {
    expect(() =>
      DocumentVersionSchema.parse({ ...validVersion, versionNumber: 0 }),
    ).toThrow();
  });

  it("rejects a missing orgId", () => {
    const { orgId: _orgId, ...noOrg } = validVersion;
    void _orgId;
    expect(() => DocumentVersionSchema.parse(noOrg)).toThrow();
  });
});

describe("DocumentDeletionSchema", () => {
  const validDeletion = {
    id: "66666666-6666-4666-8666-666666666666",
    documentId: DOCUMENT_ID,
    orgId: ORG_ID,
    softDeletedBy: USER_ID,
    hardDeletedAt: new Date("2026-07-16T00:00:00.000Z"),
  };

  it("parses a valid row", () => {
    expect(DocumentDeletionSchema.parse(validDeletion).orgId).toBe(ORG_ID);
  });

  it("rejects a missing hardDeletedAt", () => {
    const rest: Record<string, unknown> = { ...validDeletion };
    delete rest.hardDeletedAt;
    expect(() => DocumentDeletionSchema.parse(rest)).toThrow();
  });
});

describe("OpportunityDTOSchema", () => {
  const validDTO = {
    id: OPPORTUNITY_ID,
    slug: "Vendor_A",
    name: "Vendor A",
    status: "active" as const,
    createdAt: "2026-07-16T00:00:00.000Z",
  };

  it("parses a valid DTO", () => {
    expect(OpportunityDTOSchema.parse(validDTO).name).toBe("Vendor A");
  });

  it("rejects an invalid slug", () => {
    expect(() =>
      OpportunityDTOSchema.parse({ ...validDTO, slug: "has space" }),
    ).toThrow();
  });
});

describe("DocumentVersionDTOSchema", () => {
  const validDTO = {
    id: VERSION_ID,
    versionNumber: 1,
    originalFilename: "Term Sheet.pdf",
    mimeType: "application/pdf" as const,
    sizeBytes: 2048,
    sha256: "deadbeef",
    uploadedBy: USER_ID,
    uploadedAt: "2026-07-16T00:00:00.000Z",
  };

  it("strips s3Key/s3VersionId even when present in the input (no leak)", () => {
    // Feed the S3 internals in explicitly: if a regression re-added
    // `s3Key`/`s3VersionId` to the DTO schema they'd survive the parse.
    // z.object drops unknown keys, so a correct DTO strips them.
    const parsed = DocumentVersionDTOSchema.parse({
      ...validDTO,
      s3Key: "orgs/org-id/documents/doc-id/version-id",
      s3VersionId: "s3-version-abc",
    });
    expect(parsed).toEqual(validDTO);
    expect(parsed).not.toHaveProperty("s3Key");
    expect(parsed).not.toHaveProperty("s3VersionId");
  });

  it("rejects a non-positive sizeBytes", () => {
    expect(() =>
      DocumentVersionDTOSchema.parse({ ...validDTO, sizeBytes: -1 }),
    ).toThrow();
  });
});

describe("RoomDTOSchema", () => {
  it("parses a valid room DTO", () => {
    const dto = {
      folders: ["01_Company_Overview", "02_Financials"] as const,
      opportunities: [
        {
          id: OPPORTUNITY_ID,
          slug: "Vendor_A",
          name: "Vendor A",
          status: "active" as const,
          createdAt: "2026-07-16T00:00:00.000Z",
        },
      ],
    };
    expect(RoomDTOSchema.parse(dto).opportunities).toHaveLength(1);
  });

  it("rejects an invalid folder in the folders array", () => {
    expect(() =>
      RoomDTOSchema.parse({ folders: ["08_Other"], opportunities: [] }),
    ).toThrow();
  });
});

describe("FolderListingDTOSchema", () => {
  it("parses a valid folder listing", () => {
    const dto = {
      documents: [
        {
          id: DOCUMENT_ID,
          displayName: "Term Sheet.pdf",
          folder: {
            kind: "canonical" as const,
            folder: "02_Financials" as const,
          },
          currentVersion: {
            id: VERSION_ID,
            versionNumber: 1,
            originalFilename: "Term Sheet.pdf",
            mimeType: "application/pdf" as const,
            sizeBytes: 1024,
            sha256: "abc123",
            uploadedBy: USER_ID,
            uploadedAt: "2026-07-16T00:00:00.000Z",
          },
          state: "active" as const,
          createdAt: "2026-07-16T00:00:00.000Z",
        },
      ],
    };
    expect(FolderListingDTOSchema.parse(dto).documents).toHaveLength(1);
  });

  it("rejects a missing documents array", () => {
    expect(() => FolderListingDTOSchema.parse({})).toThrow();
  });
});

describe("UploadTargetSchema", () => {
  it("parses the canonical and opportunity variants", () => {
    expect(
      UploadTargetSchema.parse({ kind: "canonical", folder: "02_Financials" }),
    ).toEqual({ kind: "canonical", folder: "02_Financials" });
    expect(
      UploadTargetSchema.parse({
        kind: "opportunity",
        opportunityId: OPPORTUNITY_ID,
      }),
    ).toEqual({ kind: "opportunity", opportunityId: OPPORTUNITY_ID });
  });

  it("rejects a canonical target with an unknown folder", () => {
    expect(() =>
      UploadTargetSchema.parse({ kind: "canonical", folder: "08_Other" }),
    ).toThrow();
  });
});

describe("UploadInitiateSchema (FR9/FR10)", () => {
  const base = {
    target: { kind: "canonical" as const, folder: "02_Financials" as const },
    filename: "Term Sheet.pdf",
    mimeType: "application/pdf" as const,
    sizeBytes: 1024,
  };

  it("parses a valid initiate body", () => {
    expect(UploadInitiateSchema.parse(base).filename).toBe("Term Sheet.pdf");
  });

  it("rejects an unsupported mime type (FR9)", () => {
    expect(() =>
      UploadInitiateSchema.parse({ ...base, mimeType: "application/zip" }),
    ).toThrow();
  });

  it("accepts exactly the max size and rejects one byte over (FR10)", () => {
    expect(
      UploadInitiateSchema.parse({ ...base, sizeBytes: MAX_UPLOAD_BYTES })
        .sizeBytes,
    ).toBe(MAX_UPLOAD_BYTES);
    expect(() =>
      UploadInitiateSchema.parse({ ...base, sizeBytes: MAX_UPLOAD_BYTES + 1 }),
    ).toThrow();
  });

  it("rejects a zero/negative size", () => {
    expect(() =>
      UploadInitiateSchema.parse({ ...base, sizeBytes: 0 }),
    ).toThrow();
  });

  it("rejects a filename longer than 255 chars", () => {
    expect(() =>
      UploadInitiateSchema.parse({ ...base, filename: "a".repeat(256) }),
    ).toThrow();
  });
});

describe("UploadCompleteSchema", () => {
  const base = {
    uploadId: "upload-abc",
    documentId: DOCUMENT_ID,
    versionId: VERSION_ID,
    parts: [{ partNumber: 1, eTag: "etag-1" }],
  };

  it("parses a valid complete body", () => {
    expect(UploadCompleteSchema.parse(base).parts).toHaveLength(1);
  });

  it("rejects an empty parts array", () => {
    expect(() => UploadCompleteSchema.parse({ ...base, parts: [] })).toThrow();
  });

  it("rejects a non-uuid documentId", () => {
    expect(() =>
      UploadCompleteSchema.parse({ ...base, documentId: "nope" }),
    ).toThrow();
  });
});
