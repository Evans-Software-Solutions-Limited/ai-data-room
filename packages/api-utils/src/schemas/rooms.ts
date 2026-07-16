// Zod schemas for the room-and-folders slice (slice 2).
//
// This file is the **single source of truth** for the domain shapes
// shared between `microservices/core` (handlers + application) and
// `packages/web` (consumers). Inferred TS types are re-exported from
// `microservices/core/src/domain/room.ts` so the domain layer reads
// as a barrel-per-aggregate without duplicating definitions.
//
// References:
// - `.kiro/specs/ai-data-room/room-and-folders/requirements.md` (FR4,
//   FR9, FR10)
// - `.kiro/specs/ai-data-room/room-and-folders/design.md` §Data model,
//   §Folder path, §Zod shapes
//
// Scope (T-002): domain aggregate schemas (`opportunities`, `documents`,
// `document_versions`, `document_deletions`) plus the read-side DTOs
// used for folder/room listings and single-document fetch. Request
// DTOs for the mutating flows (`POST /uploads/initiate`,
// `POST /opportunities`, `POST /uploads/:uploadId/complete`) are
// deferred to the application/handler tasks that introduce them
// (T-006, T-007) per the house convention of scoping the domain schema
// file tightly to the task spec — see the T-004 scope note in
// `auth-orgs.ts`.
//
// Reconciliation notes:
//
// 1. **DocumentState `draft`** — design.md §Data model's `documents`
//    table lists `state` as `enum('active','soft_deleted','hard_deleted')`,
//    but §Upload pipeline requires a fourth value: rows are created
//    `draft` on `POST /uploads/initiate` and flipped to `active` on
//    `POST /uploads/:uploadId/complete`; draft rows are excluded from
//    listings. `DocumentStateSchema` below is therefore the full
//    DB-column enum (`draft` included); the client-facing
//    `DocumentDTOSchema.state` deliberately narrows to
//    `active`/`soft_deleted` only — a client should never observe a
//    draft or hard-deleted document.
// 2. **sizeBytes** — the `document_versions.size_bytes` DB column is
//    `bigint`, but FR10's 100 MB max is well within JS's safe-integer
//    range, so the schema uses `z.number().int().positive()` rather
//    than a bigint/string representation. Downstream contract (T-004/
//    T-005): `node-postgres` returns `int8`/`bigint` as a *string* by
//    default, so the Drizzle `size_bytes` column MUST be declared
//    `bigint(..., { mode: "number" })` — otherwise a valid row parses
//    to `"2048"` and `z.number()` rejects it.

import { z } from "zod";

// ─── Primitives / enums ────────────────────────────────────────────────

/**
 * The seven canonical top-level folders (design.md §Data model). Not a
 * DB table — a const enum in code, identical for every org (FR2/FR3).
 */
export const CANONICAL_FOLDERS = [
  "01_Company_Overview",
  "02_Financials",
  "03_Commercial",
  "04_Product",
  "05_Legal",
  "06_Operations",
  "07_Information_Security",
] as const;

export type CanonicalFolder = (typeof CANONICAL_FOLDERS)[number];

export const CanonicalFolderSchema = z.enum(CANONICAL_FOLDERS);

/**
 * `opportunities.status` — see design.md §Data model + FR6.
 */
export const OpportunityStatusSchema = z.enum(["active", "archived"]);

/**
 * Discriminant for a document's folder placement: one of the seven
 * canonical folders, or an Opportunity subroom.
 */
export const FolderKindSchema = z.enum(["canonical", "opportunity"]);

/**
 * `documents.state` — the full DB-column enum. See the "DocumentState
 * `draft`" reconciliation note at the top of this file: `draft` is
 * required by §Upload pipeline even though it's absent from the
 * §Data model table.
 */
export const DocumentStateSchema = z.enum([
  "draft",
  "active",
  "soft_deleted",
  "hard_deleted",
]);

/**
 * Supported upload MIME types (FR9). Exactly these eight; anything
 * else is rejected with a clear error at the application layer.
 */
export const MimeTypeEnum = z.enum([
  "application/pdf", // PDF
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // XLSX
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // PPTX
  "image/png", // PNG
  "image/jpeg", // JPG
  "text/csv", // CSV
  "text/plain", // TXT
]);

/**
 * Opportunity slug regex (design.md §Data model, FR4). Distinct from
 * `auth-orgs.ts`'s org-slug `SLUG_REGEX`: opportunity slugs allow mixed
 * case and underscores (e.g. `Vendor_A`), not just lowercase
 * alphanumerics-with-hyphens.
 */
export const OpportunitySlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, {
    message:
      "opportunity slug must be 1–64 chars of letters, digits, underscore or hyphen",
  });

// ─── Aggregates (DB-row shapes) ────────────────────────────────────────

/**
 * `opportunities` row. Represents an Opportunity subroom under
 * `Opportunities/`.
 */
export const OpportunitySchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  slug: OpportunitySlugSchema,
  name: z.string().min(1),
  status: OpportunityStatusSchema,
  archivedAt: z.coerce.date().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * `document_versions` row. Each upload creates a new version, even for
 * filename collisions (FR13).
 */
export const DocumentVersionSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  // Tenant-scoping column, denormalised from the parent document in
  // T-003 so `document_versions` is directly scopable (see the schema
  // reconciliation note in `packages/db/src/schema/rooms.ts`). Present on
  // the aggregate like every other scoped row; the client DTO
  // (`DocumentVersionDTOSchema`) deliberately omits it.
  orgId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  originalFilename: z.string().min(1).max(255),
  mimeType: MimeTypeEnum,
  sizeBytes: z.number().int().positive(),
  // Hex-string form of the `bytea` sha256 column, computed server-side
  // on upload completion (FR12). Left as a bare string here on purpose:
  // the exact canonical form (64 lowercase hex chars) is locked at the
  // repo boundary in T-004, once the `bytea`↔string mapping is chosen —
  // pinning a `.regex()` now would couple this shape to a representation
  // decision not yet made. Values are server-generated, never user input.
  sha256: z.string(),
  s3Key: z.string().min(1),
  s3VersionId: z.string().nullable(),
  uploadedBy: z.string().uuid(),
  uploadedAt: z.coerce.date(),
});

/**
 * `documents` row. A logical document; has one or more versions via
 * `DocumentVersionSchema`. The `(folderKind, canonicalFolder,
 * opportunityId)` triple is mutually constrained — `superRefine`
 * enforces design.md's §Data model CHECK constraint: exactly one of
 * `canonicalFolder`/`opportunityId` is non-null, matching `folderKind`.
 */
export const DocumentSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string().uuid(),
    folderKind: FolderKindSchema,
    canonicalFolder: CanonicalFolderSchema.nullable(),
    opportunityId: z.string().uuid().nullable(),
    displayName: z.string().min(1),
    currentVersionId: z.string().uuid().nullable(),
    state: DocumentStateSchema,
    softDeletedAt: z.coerce.date().nullable(),
    createdBy: z.string().uuid(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .superRefine((doc, ctx) => {
    if (doc.folderKind === "canonical") {
      if (doc.canonicalFolder === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["canonicalFolder"],
          message: "canonical documents must specify a canonicalFolder",
        });
      }
      if (doc.opportunityId !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["opportunityId"],
          message: "canonical documents must not carry an opportunityId",
        });
      }
    } else {
      if (doc.opportunityId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["opportunityId"],
          message: "opportunity documents must specify an opportunityId",
        });
      }
      if (doc.canonicalFolder !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["canonicalFolder"],
          message: "opportunity documents must not carry a canonicalFolder",
        });
      }
    }
  });

/**
 * `document_deletions` row. Audit-adjacent record retained
 * post-hard-delete for forensic reconstruction — no filenames stored
 * here (design.md §Data model).
 */
export const DocumentDeletionSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  orgId: z.string().uuid(),
  softDeletedBy: z.string().uuid(),
  hardDeletedAt: z.coerce.date(),
});

// ─── FolderPath discriminated union ────────────────────────────────────

/**
 * A document's folder placement (design.md §Folder path): either a
 * canonical folder, or an Opportunity subroom identified by id (plus
 * its slug, so nav/listings can render a label without a second
 * lookup).
 */
export const FolderPathSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("canonical"), folder: CanonicalFolderSchema }),
  z.object({
    kind: z.literal("opportunity"),
    opportunityId: z.string().uuid(),
    slug: OpportunitySlugSchema,
  }),
]);

// ─── Read-side DTOs (client-facing) ────────────────────────────────────

/**
 * Client-facing version DTO. Deliberately OMITS `s3Key` and
 * `s3VersionId` — S3 internals must never reach a client.
 */
export const DocumentVersionDTOSchema = z.object({
  id: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  originalFilename: z.string(),
  mimeType: MimeTypeEnum,
  sizeBytes: z.number().int().positive(),
  sha256: z.string(),
  uploadedBy: z.string().uuid(),
  uploadedAt: z.string(),
});

/**
 * Client-facing document DTO (design.md §Zod shapes, matches
 * `DocumentDTO` exactly). `state` is narrowed to client-visible states
 * only — no `draft`/`hard_deleted` (see the DocumentState reconciliation
 * note at the top of this file).
 */
export const DocumentDTOSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  folder: FolderPathSchema,
  currentVersion: DocumentVersionDTOSchema,
  state: z.enum(["active", "soft_deleted"]),
  createdAt: z.string(),
});

/**
 * Client-facing opportunity DTO.
 */
export const OpportunityDTOSchema = z.object({
  id: z.string().uuid(),
  slug: OpportunitySlugSchema,
  name: z.string(),
  status: OpportunityStatusSchema,
  createdAt: z.string(),
});

/**
 * `GET /rooms` response: canonical folders + opportunities list for
 * the org.
 */
export const RoomDTOSchema = z.object({
  folders: z.array(CanonicalFolderSchema),
  opportunities: z.array(OpportunityDTOSchema),
});

/**
 * A folder's contents — response shape for `GET /rooms/folders/:canonical`
 * and `GET /opportunities/:id/documents`.
 */
export const FolderListingDTOSchema = z.object({
  documents: z.array(DocumentDTOSchema),
});

// ─── Upload request schemas (T-007) ──────────────────────────────────

/**
 * Where an upload lands: one of the seven canonical folders, or an
 * Opportunity subroom by id. Distinct from `FolderPathSchema` — the
 * client initiating an upload identifies an opportunity by id only (it
 * needn't know the slug), so no `slug` on the opportunity variant.
 */
export const UploadTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("canonical"), folder: CanonicalFolderSchema }),
  z.object({
    kind: z.literal("opportunity"),
    opportunityId: z.string().uuid(),
  }),
]);

/** Max single-file size (FR10). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * `POST /uploads/initiate` body. `mimeType` ∈ `MimeTypeEnum` enforces
 * FR9 (unsupported types rejected here); `sizeBytes` ≤ `MAX_UPLOAD_BYTES`
 * enforces FR10 — both at the schema boundary before any S3 call.
 */
export const UploadInitiateSchema = z.object({
  target: UploadTargetSchema,
  filename: z.string().min(1).max(255),
  mimeType: MimeTypeEnum,
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

/**
 * `POST /uploads/:uploadId/complete` body. The client echoes the ticket
 * `initiateUpload` returned (`documentId` / `versionId` / `uploadId`) —
 * completion is safe because every DB write is org-scoped and the S3
 * `uploadId` is bound to the server-derived object key.
 */
export const UploadCompleteSchema = z.object({
  uploadId: z.string().min(1),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        eTag: z.string().min(1),
      }),
    )
    .min(1),
});

// ─── Inferred types (re-exported from `core/src/domain/room.ts`) ──────

export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;
export type FolderKind = z.infer<typeof FolderKindSchema>;
export type DocumentState = z.infer<typeof DocumentStateSchema>;
export type MimeType = z.infer<typeof MimeTypeEnum>;

export type Opportunity = z.infer<typeof OpportunitySchema>;
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;
export type Document = z.infer<typeof DocumentSchema>;
export type DocumentDeletion = z.infer<typeof DocumentDeletionSchema>;
export type FolderPath = z.infer<typeof FolderPathSchema>;

export type DocumentVersionDTO = z.infer<typeof DocumentVersionDTOSchema>;
export type DocumentDTO = z.infer<typeof DocumentDTOSchema>;
export type OpportunityDTO = z.infer<typeof OpportunityDTOSchema>;
export type RoomDTO = z.infer<typeof RoomDTOSchema>;
export type FolderListingDTO = z.infer<typeof FolderListingDTOSchema>;

export type UploadTarget = z.infer<typeof UploadTargetSchema>;
export type UploadInitiate = z.infer<typeof UploadInitiateSchema>;
export type UploadComplete = z.infer<typeof UploadCompleteSchema>;
