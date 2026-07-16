// Drizzle-backed repository for the `document_versions` aggregate.
//
// room-and-folders (slice 2) / T-004. Extends `ScopedRepo` (ADR-011):
// scoped reads + org-stamped writes. `document_versions` carries its own
// `org_id` (denormalised from the parent document in T-003) precisely so
// it can be scoped like every other tenant table. Constructed only by
// the `scopedRepo` factory; raw access is banned outside this allowlisted
// file by the CI tripwire.
//
// This repo owns the `bytea` ⇄ hex-string mapping for `sha256`: the DB
// column is 32 raw bytes (`bytea`), the domain type
// (`DocumentVersion.sha256`) is the 64-char lowercase-hex form. All
// conversion happens here so no other layer touches Buffers (resolves the
// T-003 repo-boundary carry-forward). Append-only (NFR8) — no update or
// delete methods; versions vanish only via the parent document's
// ON DELETE CASCADE.
//
// Backs upload-complete (T-007, `create`) and version history (T-008,
// `listByDocument`).

import { asc, desc, eq } from "drizzle-orm";
import type { Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type { DocumentVersion } from "@ai-data-room/api-utils/schemas/rooms";

import { ScopedRepo } from "./scopedRepoBase";
import { firstOrNull } from "./_helpers";

const { documentVersions } = schema;

/** A canonical sha-256 digest: exactly 64 lowercase hex chars. The
 *  `DocumentVersion.sha256` domain field defers its format guard to "the
 *  repo boundary in T-004" — this is that guard. `Buffer.from(x, "hex")`
 *  silently truncates on a non-hex or odd-length string (dropping bytes
 *  rather than erroring), so a malformed digest would otherwise persist
 *  corrupted; we reject it up front instead. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface CreateDocumentVersionInput {
  /** Optional explicit id. T-007's upload flow mints the version id at
   *  initiate (it's the last segment of the S3 key), then persists the
   *  row with that same id at complete. Omit to let the DB default a
   *  fresh `gen_random_uuid()`. */
  id?: string;
  documentId: string;
  versionNumber: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  /** 64-char lowercase hex sha-256 of the object contents (FR12). */
  sha256: string;
  s3Key: string;
  s3VersionId?: string | null;
  uploadedBy: string;
}

/** The raw Drizzle row shape for a version, before domain mapping.
 *  `sha256` is the `bytea` Buffer; the mapper renders it to hex. */
export type VersionRow = typeof documentVersions.$inferSelect;

/** Map a DB row to the domain `DocumentVersion`: the only transform is
 *  `sha256` bytea → lowercase hex. `sizeBytes` is already a JS number
 *  (column is `bigint(mode:"number")`); timestamps are `Date`. Exported
 *  so `DocumentRepo.getWithCurrentVersion` maps the joined version row
 *  through the same single conversion point. */
export function rowToVersion(row: VersionRow): DocumentVersion {
  return {
    id: row.id,
    documentId: row.documentId,
    orgId: row.orgId,
    versionNumber: row.versionNumber,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: Buffer.from(row.sha256).toString("hex"),
    s3Key: row.s3Key,
    s3VersionId: row.s3VersionId,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
  } as DocumentVersion;
}

export class DocumentVersionRepo extends ScopedRepo {
  withTx(tx: Tx): DocumentVersionRepo {
    return new DocumentVersionRepo(tx, this.orgId);
  }

  /**
   * Create a new version row (FR13/FR15) — one per upload, even for a
   * same-name re-upload. `org_id` is stamped from the bound scope, so a
   * version always lands in the same org as the document; the
   * application layer (T-007) is responsible for passing the correct
   * `versionNumber` (see `latestVersionNumber`).
   */
  async create(input: CreateDocumentVersionInput): Promise<DocumentVersion> {
    if (!SHA256_HEX.test(input.sha256)) {
      // Server-computed value (FR12), so a bad digest is a programming /
      // integrity bug, not user input — surface it loudly (500-class)
      // rather than silently store truncated bytes. No value in the
      // message (it could reach logs); length is enough to diagnose.
      throw new Error(
        `document version sha256 must be 64 lowercase hex chars (got ${input.sha256.length})`,
      );
    }
    const values = this.stampOrgId({
      ...(input.id ? { id: input.id } : {}),
      documentId: input.documentId,
      versionNumber: input.versionNumber,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: Buffer.from(input.sha256, "hex"),
      s3Key: input.s3Key,
      s3VersionId: input.s3VersionId ?? null,
      uploadedBy: input.uploadedBy,
    });
    const [row] = await this.db
      .insert(documentVersions)
      .values(values)
      .returning();
    return rowToVersion(row as VersionRow);
  }

  /** A single version by id within the bound org, or `null`. */
  async findById(id: string): Promise<DocumentVersion | null> {
    const rows = await this.db
      .select()
      .from(documentVersions)
      .where(this.scoped(documentVersions.orgId, eq(documentVersions.id, id)));
    const row = firstOrNull(rows as VersionRow[]);
    return row ? rowToVersion(row) : null;
  }

  /** Version history for a document (FR15), oldest first. Scoped, so a
   *  foreign-org `documentId` yields an empty list, never a leak. */
  async listByDocument(documentId: string): Promise<DocumentVersion[]> {
    const rows = await this.db
      .select()
      .from(documentVersions)
      .where(
        this.scoped(
          documentVersions.orgId,
          eq(documentVersions.documentId, documentId),
        ),
      )
      .orderBy(asc(documentVersions.versionNumber));
    return (rows as VersionRow[]).map(rowToVersion);
  }

  /**
   * The highest `version_number` for a document within the bound org, or
   * `0` if it has none. The upload path (T-007) adds 1 to compute the
   * next version on a filename collision (FR13). The unique
   * `(document_id, version_number)` index is the ultimate guard against
   * a racing duplicate.
   */
  async latestVersionNumber(documentId: string): Promise<number> {
    const rows = await this.db
      .select({ versionNumber: documentVersions.versionNumber })
      .from(documentVersions)
      .where(
        this.scoped(
          documentVersions.orgId,
          eq(documentVersions.documentId, documentId),
        ),
      )
      .orderBy(desc(documentVersions.versionNumber))
      .limit(1);
    return rows[0]?.versionNumber ?? 0;
  }
}
