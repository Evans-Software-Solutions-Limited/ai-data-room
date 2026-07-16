// Shared DTO mappers for the room-and-folders read side — room-and-folders
// (slice 2) / T-008.
//
// One conversion point for domain aggregate → client-facing DTO, shared by
// `listing.ts` (folder/room listings) and `download.ts` (single-document
// fetch) so the shape (and its omissions — `s3Key`/`s3VersionId` must never
// reach a client) is defined exactly once.

import type {
  Document,
  DocumentDTO,
  DocumentVersion,
  DocumentVersionDTO,
  Opportunity,
  OpportunityDTO,
} from "@ai-data-room/api-utils/schemas/rooms";

/** Map a `document_versions` row to its client-facing DTO. Deliberately
 *  omits `s3Key` / `s3VersionId` (S3 internals must never reach a client —
 *  see `DocumentVersionDTOSchema`'s doc comment) and `orgId` (scoping
 *  column, not client-relevant). */
export function toDocumentVersionDTO(v: DocumentVersion): DocumentVersionDTO {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    originalFilename: v.originalFilename,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    sha256: v.sha256,
    uploadedBy: v.uploadedBy,
    uploadedAt: v.uploadedAt.toISOString(),
  };
}

/** Map an `opportunities` row to its client-facing DTO. */
export function toOpportunityDTO(o: Opportunity): OpportunityDTO {
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
  };
}

/**
 * Build a client-facing `DocumentDTO` from a `documents` row plus its
 * current version. `currentVersion` is typed nullable because the repo
 * layer resolves it via a LEFT JOIN (a `draft` document has none), but an
 * ACTIVE document (the only state T-008 surfaces) always has one — a
 * `null` here means the current-version pointer is broken, a data-integrity
 * bug, not a valid state to render as a DTO. `opportunitySlug` is required
 * for an opportunity-folder document (the DTO's `FolderPath` needs it) —
 * the caller resolves it via `OpportunityRepo.findById` and passes it down,
 * since the document row only carries `opportunityId`.
 */
export function toDocumentDTO(
  doc: Document,
  currentVersion: DocumentVersion | null,
  opportunitySlug?: string,
): DocumentDTO {
  if (!currentVersion) {
    throw new Error(
      `document "${doc.id}" has no current version — data-integrity error`,
    );
  }
  if (doc.folderKind === "opportunity" && !opportunitySlug) {
    // The caller must resolve + pass the opportunity's slug (the DTO's
    // FolderPath needs it). A missing slug would otherwise render as
    // `{ kind: "opportunity", slug: undefined }` — a malformed DTO that
    // fails validation downstream; fail loudly here instead.
    throw new Error(
      `document "${doc.id}" is in an opportunity folder but no slug was ` +
        `resolved — data-integrity error`,
    );
  }

  const folder =
    doc.folderKind === "canonical"
      ? ({ kind: "canonical", folder: doc.canonicalFolder! } as const)
      : ({
          kind: "opportunity",
          opportunityId: doc.opportunityId!,
          slug: opportunitySlug!,
        } as const);

  return {
    id: doc.id,
    displayName: doc.displayName,
    folder,
    currentVersion: toDocumentVersionDTO(currentVersion),
    // T-008 only ever surfaces `active` documents (drafts and hard-deleted
    // rows are excluded by every repo read this DTO is built from), but map
    // faithfully rather than assume — a future caller passing a
    // soft-deleted doc (e.g. an admin restore-preview screen) still gets a
    // correct DTO. `draft`/`hard_deleted` can't legitimately reach here (a
    // draft has no current version, and a hard-deleted row no longer
    // exists to be read) — treat either as `active` rather than fail the
    // response over a state the DTO schema doesn't even have a slot for.
    state: doc.state === "soft_deleted" ? "soft_deleted" : "active",
    createdAt: doc.createdAt.toISOString(),
  };
}
