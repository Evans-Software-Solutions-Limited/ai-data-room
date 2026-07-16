// Application-layer document upload — room-and-folders (slice 2) / T-007.
//
// Covers FR8–FR13: resumable multipart upload into a canonical folder or
// an Opportunity subroom, with a filename collision resolved as a NEW
// VERSION of the existing document (FR13/FR15), never an overwrite.
//
// ── Reconciliations vs design.md §Upload pipeline (flagged in PR) ─────
//
// 1. **Version row is created at COMPLETE, not initiate.**
//    `document_versions.sha256` is `NOT NULL` and the table is append-only
//    (NFR8), but the sha-256 is only knowable after the bytes land — the
//    S3 wrapper streams the finished object to hash it (`computeSha256`).
//    So initiate cannot write a version row; it mints the version id (used
//    as the S3 key's last segment) and the row is persisted at complete
//    with that same id + the computed digest.
// 2. **initiate returns an upload ticket the client echoes at complete.**
//    The design's `POST /uploads/:uploadId/complete` body is `{ parts }`,
//    which assumes server-side pending state keyed by `uploadId`. There is
//    no pending-uploads table (only the 4 room tables), so instead
//    initiate returns `{ uploadId, documentId, versionId, key, parts }`
//    and complete accepts `{ uploadId, documentId, versionId, parts }`.
//    This is safe: every DB write is org-scoped (a foreign documentId/
//    versionId can't be activated), the key is RE-DERIVED server-side
//    (never trusted from the client), and the S3 `uploadId` is bound to
//    that derived key so a tampered id fails the S3 CompleteMultipartUpload.
//
// The draft `documents` row created by initiate for a brand-new document
// is the janitor's handle (T-012 sweeps drafts >24h + aborts their S3
// multipart). A collision upload reuses the existing active document and
// creates no draft, so an abandoned collision upload relies on S3's
// 7-day multipart auto-abort (design §Upload pipeline "safety net").

import { randomUUID } from "node:crypto";

import type { Db } from "@ai-data-room/db";
import {
  MAX_UPLOAD_BYTES,
  type MimeType,
  type UploadTarget,
} from "@ai-data-room/api-utils/schemas/rooms";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { DocumentRepo } from "../../infrastructure/db/documentRepo";
import type { DocumentVersionRepo } from "../../infrastructure/db/documentVersionRepo";
import type { OpportunityRepo } from "../../infrastructure/db/opportunityRepo";
import type { S3DocumentStore } from "../../infrastructure/s3/client";

import { type AuditContext, safeAudit } from "../_audit-context";

export type UploadErrorReason =
  /** Opportunity target is unknown, foreign-org, or archived. */
  | "folder_not_found"
  /** Document gone (unknown / foreign-org) at complete time. */
  | "not_found"
  /** Document is soft- or hard-deleted — can't complete an upload into it. */
  | "invalid_state"
  /** The completed object exceeds MAX_UPLOAD_BYTES (FR10) — a presigned
   *  part URL doesn't cap body size, so the real size is re-checked here. */
  | "too_large"
  /** A concurrent upload won a uniqueness race (active-name backstop, or
   *  the per-document version-number index). Retrying resolves it — the
   *  retry's initiate finds the now-active document and adds a version. */
  | "conflict"
  /** markActive/setCurrentVersion matched zero rows (lost a race). */
  | "activation_failed";

export class UploadError extends Error {
  public readonly reason: UploadErrorReason;
  constructor(reason: UploadErrorReason) {
    super(reason);
    this.name = "UploadError";
    this.reason = reason;
  }
}

/** Postgres unique-violation SQLSTATE (surfaced as `.code` by postgres.js).
 *  At complete time this means a concurrent upload beat us to the active
 *  (folder, name) slot or the next version number. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

/** Multipart part size (5 MB — the `@aws-sdk/lib-storage` default). The
 *  server presigns one URL per part of this size; the web client (T-014)
 *  MUST chunk with the same size so its part boundaries line up. */
export const UPLOAD_PART_SIZE = 5 * 1024 * 1024;

/** TTL for the presigned part-upload URLs — generous enough to upload a
 *  100 MB file over a slow link without re-initiating. */
const PART_URL_TTL_SECONDS = 60 * 60;

/** The one place the storage-layout convention (design §Storage layout)
 *  is applied on the write path: `orgs/<org>/documents/<doc>/<version>`.
 *  No original filename in the key (prevents leakage if a URL is sniffed;
 *  stable across renames). */
function documentKey(
  orgId: string,
  documentId: string,
  versionId: string,
): string {
  return `orgs/${orgId}/documents/${documentId}/${versionId}`;
}

// ---------------------------------------------------------------------------
// initiateUpload
// ---------------------------------------------------------------------------

export interface InitiateUploadInput {
  target: UploadTarget;
  filename: string;
  mimeType: MimeType;
  sizeBytes: number;
  actorUserId: string;
}

export interface InitiateUploadDeps {
  documents: DocumentRepo;
  opportunities: OpportunityRepo;
  store: S3DocumentStore;
}

export interface InitiateUploadResult {
  uploadId: string;
  documentId: string;
  versionId: string;
  key: string;
  parts: { partNumber: number; url: string }[];
}

export async function initiateUpload(
  input: InitiateUploadInput,
  deps: InitiateUploadDeps,
): Promise<InitiateUploadResult> {
  const { target } = input;

  // An upload into an Opportunity subroom requires a live subroom.
  if (target.kind === "opportunity") {
    const opp = await deps.opportunities.findById(target.opportunityId);
    if (!opp || opp.status !== "active") {
      throw new UploadError("folder_not_found");
    }
  }

  // FR13: a filename collision in the same folder means a new VERSION of
  // the existing active document, not a second document.
  const existing =
    target.kind === "canonical"
      ? await deps.documents.findActiveByName({
          folderKind: "canonical",
          canonicalFolder: target.folder,
          displayName: input.filename,
        })
      : await deps.documents.findActiveByName({
          folderKind: "opportunity",
          opportunityId: target.opportunityId,
          displayName: input.filename,
        });

  const documentId = existing
    ? existing.id
    : (
        await deps.documents.create({
          folderKind: target.kind,
          canonicalFolder: target.kind === "canonical" ? target.folder : null,
          opportunityId:
            target.kind === "opportunity" ? target.opportunityId : null,
          displayName: input.filename,
          createdBy: input.actorUserId,
        })
      ).id;

  const versionId = randomUUID();
  const orgId = deps.documents.scopeOrgId;
  const key = documentKey(orgId, documentId, versionId);

  const uploadId = await deps.store.createMultipartUpload(key, input.mimeType);

  const partCount = Math.max(1, Math.ceil(input.sizeBytes / UPLOAD_PART_SIZE));
  const parts = await deps.store.presignPartUrls(
    key,
    uploadId,
    Array.from({ length: partCount }, (_, i) => i + 1),
    PART_URL_TTL_SECONDS,
  );

  return { uploadId, documentId, versionId, key, parts };
}

// ---------------------------------------------------------------------------
// completeUpload
// ---------------------------------------------------------------------------

export interface CompleteUploadInput {
  uploadId: string;
  documentId: string;
  versionId: string;
  parts: { partNumber: number; eTag: string }[];
  actorUserId: string;
  audit: AuditContext;
}

export interface CompleteUploadDeps {
  db: Db;
  documents: DocumentRepo;
  documentVersions: DocumentVersionRepo;
  store: S3DocumentStore;
  auditRepo: AuditRepo;
}

export interface CompleteUploadResult {
  documentId: string;
  versionId: string;
  versionNumber: number;
}

export async function completeUpload(
  input: CompleteUploadInput,
  deps: CompleteUploadDeps,
): Promise<CompleteUploadResult> {
  const doc = await deps.documents.findById(input.documentId);
  if (!doc) {
    throw new UploadError("not_found");
  }
  // Only a draft (first version) or an active document (FR13 new version)
  // can receive a completed upload — never a soft/hard-deleted one.
  if (doc.state !== "draft" && doc.state !== "active") {
    throw new UploadError("invalid_state");
  }

  const orgId = deps.documents.scopeOrgId;
  // Re-derive the key server-side — never trust a client-supplied key.
  const key = documentKey(orgId, input.documentId, input.versionId);

  // External S3 work happens BEFORE the DB tx (matches createOrg's
  // external-calls-first ordering): finalise the object, then read its
  // size + hash its bytes for the metadata the version row records (FR12).
  const { versionId: s3VersionId } = await deps.store.completeMultipartUpload(
    key,
    input.uploadId,
    input.parts,
  );
  const head = await deps.store.headObject(key);
  // FR10 enforced against the REAL object, not the declared size: a
  // presigned UploadPart URL caps neither part nor total body size, so a
  // client could PUT far more than the `sizeBytes` it declared at initiate
  // (which only sized the presigned part list). Delete the oversized
  // object so it doesn't linger, then reject.
  if (head.sizeBytes > MAX_UPLOAD_BYTES) {
    // Best-effort cleanup of the oversized bytes (no version row is written
    // and the doc is never activated, so FR10 holds regardless). On the
    // versioning-enabled bucket this leaves a noncurrent version + delete
    // marker; the bucket lifecycle rule (T-001) / retention sweep reclaim
    // those — we don't pass a versionId here.
    await deps.store.deleteObject(key);
    throw new UploadError("too_large");
  }
  const sha256 = await deps.store.computeSha256(key);
  const mimeType = head.contentType;
  if (!mimeType) {
    // The object was created with an explicit ContentType at initiate;
    // its absence on HEAD is an integrity/programming error, not user input.
    throw new Error(`completed object "${key}" has no content-type`);
  }

  // Compute the next version number as late as possible to shrink the
  // race window; the unique (document_id, version_number) index is the
  // ultimate guard against a concurrent duplicate.
  const versionNumber =
    (await deps.documentVersions.latestVersionNumber(input.documentId)) + 1;

  // Version insert + document activation are atomic: a document can never
  // be left active pointing at a version that wasn't written, or a version
  // written without the document being flipped active. A unique-violation
  // (active-name backstop, or the (document_id, version_number) index)
  // means a concurrent upload raced us — surface a retryable `conflict`
  // rather than a raw 500.
  const result = await deps.db
    .transaction(async (tx) => {
      await deps.documentVersions.withTx(tx).create({
        id: input.versionId,
        documentId: input.documentId,
        versionNumber,
        originalFilename: doc.displayName,
        mimeType,
        sizeBytes: head.sizeBytes,
        sha256,
        s3Key: key,
        s3VersionId,
        uploadedBy: input.actorUserId,
      });

      const activated =
        doc.state === "draft"
          ? await deps.documents
              .withTx(tx)
              .markActive(input.documentId, input.versionId)
          : await deps.documents
              .withTx(tx)
              .setCurrentVersion(input.documentId, input.versionId);
      if (!activated) {
        throw new UploadError("activation_failed");
      }
      return activated;
    })
    .catch((err: unknown) => {
      // A unique-violation (active-name backstop, or the
      // (document_id, version_number) index) means a concurrent upload
      // raced us — surface a retryable `conflict`, not a raw 500.
      if (isUniqueViolation(err)) {
        throw new UploadError("conflict");
      }
      throw err;
    });

  await safeAudit(deps, {
    eventType: "file_uploaded",
    outcome: "success",
    actorUserId: input.actorUserId,
    orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      documentId: input.documentId,
      versionId: input.versionId,
      versionNumber,
      sizeBytes: head.sizeBytes,
      mimeType,
    },
  });

  return {
    documentId: result.id,
    versionId: input.versionId,
    versionNumber,
  };
}
