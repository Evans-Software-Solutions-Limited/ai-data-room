// Drizzle-backed repository for the `documents` aggregate.
//
// room-and-folders (slice 2) / T-004. Extends `ScopedRepo` (ADR-011):
// scoped reads + org-stamped writes. Constructed only by the `scopedRepo`
// factory; raw access to `documents` is banned outside this allowlisted
// file by the CI tripwire.
//
// Backs listing/download (T-008: `listByCanonicalFolder`,
// `listByOpportunity`, `getWithCurrentVersion`), upload-complete (T-007:
// `markActive`), and soft-delete/restore/hard-delete (T-009). Folder
// placement is the XOR the DB CHECK + the domain `DocumentSchema`
// enforce; this repo trusts a validated input and persists it.

import { and, asc, eq, exists, lt, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  CanonicalFolder,
  Document,
  DocumentVersion,
  FolderKind,
} from "@ai-data-room/api-utils/schemas/rooms";

import { ScopedRepo } from "./scopedRepoBase";
import { rowToVersion, type VersionRow } from "./documentVersionRepo";
import { firstOrNull } from "./_helpers";

const { documents, documentVersions } = schema;

export interface CreateDocumentInput {
  folderKind: FolderKind;
  canonicalFolder?: CanonicalFolder | null;
  opportunityId?: string | null;
  displayName: string;
  createdBy: string;
}

/** A document plus its resolved current version (design "get-with-current
 *  -version"). `currentVersion` is `null` for a `draft` document that has
 *  no completed version yet. */
export interface DocumentWithCurrentVersion {
  document: Document;
  currentVersion: DocumentVersion | null;
}

export class DocumentRepo extends ScopedRepo {
  withTx(tx: Tx): DocumentRepo {
    return new DocumentRepo(tx, this.orgId);
  }

  /**
   * A predicate that holds only if `versionId` names a version OF THIS
   * document (`documentId`) in the bound org. Folded into the
   * `markActive` / `setCurrentVersion` UPDATE WHERE so a document can
   * never be pointed at another org's version (cross-tenant) NOR at a
   * same-org version belonging to a different document (integrity): if
   * the version is foreign, wrong-document, or missing, the UPDATE
   * matches zero rows and the caller gets `null` rather than a bad
   * pointer. The DB has no composite FK for this (ADR-011 is app-layer
   * isolation), so this is the guard.
   */
  private versionInScope(documentId: string, versionId: string): SQL {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.documentId, documentId),
            eq(documentVersions.orgId, this.orgId),
          ),
        ),
    );
  }

  /**
   * Insert a document row (state defaults to `draft` at the DB — the
   * upload-initiate path, T-007). The caller passes exactly one of
   * `canonicalFolder` / `opportunityId` matching `folderKind`; the DB
   * `documents_folder_kind_xor` CHECK is the backstop.
   */
  async create(input: CreateDocumentInput): Promise<Document> {
    const [row] = await this.db
      .insert(documents)
      .values(
        this.stampOrgId({
          folderKind: input.folderKind,
          canonicalFolder: input.canonicalFolder ?? null,
          opportunityId: input.opportunityId ?? null,
          displayName: input.displayName,
          createdBy: input.createdBy,
        }),
      )
      .returning();
    return row as Document;
  }

  /**
   * The active document with `displayName` in the given folder, or `null`
   * (T-007 filename-collision detection, FR13). Matches `state='active'`
   * + the folder (canonical folder or opportunity id) + display name,
   * scoped to the bound org. Ordered by `created_at` so the result is
   * deterministic if (against the FR13 invariant, which the app upholds)
   * two active docs ever share a name — there is no DB unique on it.
   */
  async findActiveByName(
    input: { displayName: string } & (
      | { folderKind: "canonical"; canonicalFolder: CanonicalFolder }
      | { folderKind: "opportunity"; opportunityId: string }
    ),
  ): Promise<Document | null> {
    const folderMatch =
      input.folderKind === "canonical"
        ? and(
            eq(documents.folderKind, "canonical"),
            eq(documents.canonicalFolder, input.canonicalFolder),
          )
        : and(
            eq(documents.folderKind, "opportunity"),
            eq(documents.opportunityId, input.opportunityId),
          );
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        this.scoped(
          documents.orgId,
          and(
            eq(documents.state, "active"),
            eq(documents.displayName, input.displayName),
            folderMatch,
          ),
        ),
      )
      .orderBy(asc(documents.createdAt))
      .limit(1);
    return firstOrNull(rows as Document[]);
  }

  /** A single document by id within the bound org, or `null`. */
  async findById(id: string): Promise<Document | null> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(this.scoped(documents.orgId, eq(documents.id, id)));
    return firstOrNull(rows as Document[]);
  }

  /**
   * A document plus its current version in one round-trip (design
   * "get-with-current-version"), scoped to the bound org. LEFT JOIN so a
   * `draft` document with no `current_version_id` still returns (with a
   * null version). Returns `null` if the document id is unknown / foreign
   * -org.
   */
  async getWithCurrentVersion(
    id: string,
  ): Promise<DocumentWithCurrentVersion | null> {
    const rows = await this.db
      .select()
      .from(documents)
      .leftJoin(
        documentVersions,
        // Scope the JOINED table too, not just `documents` in the WHERE:
        // without `documentVersions.orgId = <bound org>` a document whose
        // `current_version_id` somehow points at a foreign-org version
        // would leak that version's row. Belt to the write-side guard in
        // `markActive`/`setCurrentVersion` (which refuse a foreign-org
        // versionId) — a scoped read must never trust the pointer.
        and(
          eq(documents.currentVersionId, documentVersions.id),
          eq(documentVersions.orgId, this.orgId),
        ),
      )
      .where(this.scoped(documents.orgId, eq(documents.id, id)));
    const row = rows[0] as
      | { documents: Document; document_versions: VersionRow | null }
      | undefined;
    if (!row) return null;
    return {
      document: row.documents,
      currentVersion: row.document_versions
        ? rowToVersion(row.document_versions)
        : null,
    };
  }

  /**
   * Active documents in a canonical folder (design "list-by-folder"),
   * ordered by display name. Only `state='active'` — drafts, soft- and
   * hard-deleted rows are excluded. Served by the
   * `documents_canonical_listing_idx`.
   */
  async listByCanonicalFolder(folder: CanonicalFolder): Promise<Document[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        this.scoped(
          documents.orgId,
          and(
            eq(documents.folderKind, "canonical"),
            eq(documents.canonicalFolder, folder),
            eq(documents.state, "active"),
          ),
        ),
      )
      .orderBy(asc(documents.displayName));
    return rows as Document[];
  }

  /**
   * Active documents in an Opportunity subroom (design
   * "list-by-opportunity"), ordered by display name. Served by the
   * `documents_opportunity_listing_idx`.
   */
  async listByOpportunity(opportunityId: string): Promise<Document[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        this.scoped(
          documents.orgId,
          and(
            eq(documents.opportunityId, opportunityId),
            eq(documents.state, "active"),
          ),
        ),
      )
      .orderBy(asc(documents.displayName));
    return rows as Document[];
  }

  /**
   * Active documents in a canonical folder, each joined to its current
   * version in one round-trip (T-008, NFR4: avoids an N+1 over up to 500
   * docs). Mirrors `getWithCurrentVersion`'s LEFT JOIN — scoping BOTH
   * tables, not just `documents` in the WHERE — for the same reason: a
   * `current_version_id` pointing at a foreign-org version must never
   * leak that row. Ordered by display name for a stable listing.
   */
  async listByCanonicalFolderWithVersion(
    folder: CanonicalFolder,
  ): Promise<DocumentWithCurrentVersion[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .leftJoin(
        documentVersions,
        and(
          eq(documents.currentVersionId, documentVersions.id),
          eq(documentVersions.orgId, this.orgId),
        ),
      )
      .where(
        this.scoped(
          documents.orgId,
          and(
            eq(documents.folderKind, "canonical"),
            eq(documents.canonicalFolder, folder),
            eq(documents.state, "active"),
          ),
        ),
      )
      .orderBy(asc(documents.displayName));
    return (
      rows as { documents: Document; document_versions: VersionRow | null }[]
    ).map((row) => ({
      document: row.documents,
      currentVersion: row.document_versions
        ? rowToVersion(row.document_versions)
        : null,
    }));
  }

  /**
   * Active documents in an Opportunity subroom, each joined to its
   * current version in one round-trip (T-008, NFR4). Same LEFT JOIN
   * scoping as `listByCanonicalFolderWithVersion`. Ordered by display
   * name.
   */
  async listByOpportunityWithVersion(
    opportunityId: string,
  ): Promise<DocumentWithCurrentVersion[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .leftJoin(
        documentVersions,
        and(
          eq(documents.currentVersionId, documentVersions.id),
          eq(documentVersions.orgId, this.orgId),
        ),
      )
      .where(
        this.scoped(
          documents.orgId,
          and(
            eq(documents.opportunityId, opportunityId),
            eq(documents.state, "active"),
          ),
        ),
      )
      .orderBy(asc(documents.displayName));
    return (
      rows as { documents: Document; document_versions: VersionRow | null }[]
    ).map((row) => ({
      document: row.documents,
      currentVersion: row.document_versions
        ? rowToVersion(row.document_versions)
        : null,
    }));
  }

  /**
   * Upload-complete transition (T-007): flip a `draft` document to
   * `active` and point it at its first/newest version. Compare-and-set on
   * `state='draft'` so a double-complete is a `null` no-op, and scoped so
   * a foreign-org id can't be activated.
   */
  async markActive(id: string, versionId: string): Promise<Document | null> {
    const now = new Date();
    const rows = await this.db
      .update(documents)
      .set({ state: "active", currentVersionId: versionId, updatedAt: now })
      .where(
        this.scoped(
          documents.orgId,
          and(
            eq(documents.id, id),
            eq(documents.state, "draft"),
            this.versionInScope(id, versionId),
          ),
        ),
      )
      .returning();
    return firstOrNull(rows as Document[]);
  }

  /**
   * Set a new current version on an already-active document (T-007
   * filename-collision → new version, FR13). Compare-and-set on
   * `state='active'`.
   */
  async setCurrentVersion(
    id: string,
    versionId: string,
  ): Promise<Document | null> {
    const now = new Date();
    const rows = await this.db
      .update(documents)
      .set({ currentVersionId: versionId, updatedAt: now })
      .where(
        this.scoped(
          documents.orgId,
          and(
            eq(documents.id, id),
            eq(documents.state, "active"),
            this.versionInScope(id, versionId),
          ),
        ),
      )
      .returning();
    return firstOrNull(rows as Document[]);
  }

  /**
   * Soft-delete an active document (FR17): hide it from listings and
   * start the 30-day retention clock. Compare-and-set on `state='active'`
   * so a double-delete is a `null` no-op.
   */
  async softDelete(
    id: string,
    at: Date = new Date(),
  ): Promise<Document | null> {
    const rows = await this.db
      .update(documents)
      .set({ state: "soft_deleted", softDeletedAt: at, updatedAt: at })
      .where(
        this.scoped(
          documents.orgId,
          and(eq(documents.id, id), eq(documents.state, "active")),
        ),
      )
      .returning();
    return firstOrNull(rows as Document[]);
  }

  /**
   * Restore a soft-deleted document within its retention window (FR17).
   * Compare-and-set on `state='soft_deleted'`. The 30-day window check is
   * the application layer's job (T-009); this repo just reverses the
   * transition.
   */
  async restore(id: string): Promise<Document | null> {
    const now = new Date();
    const rows = await this.db
      .update(documents)
      .set({ state: "active", softDeletedAt: null, updatedAt: now })
      .where(
        this.scoped(
          documents.orgId,
          and(eq(documents.id, id), eq(documents.state, "soft_deleted")),
        ),
      )
      .returning();
    return firstOrNull(rows as Document[]);
  }

  /**
   * Hard-delete a document row (support-only, T-009 / retention sweep
   * T-010). ON DELETE CASCADE removes its versions. Returns the deleted
   * row, or `null` if the id is unknown / foreign-org. The
   * `document_deletions` forensic record + S3 object removal are the
   * application layer's responsibility (this repo only owns the row).
   */
  async hardDelete(id: string): Promise<Document | null> {
    const rows = await this.db
      .delete(documents)
      .where(this.scoped(documents.orgId, eq(documents.id, id)))
      .returning();
    return firstOrNull(rows as Document[]);
  }

  /**
   * Soft-deleted documents whose 30-day retention window has elapsed
   * (`soft_deleted_at < cutoff`), for the T-010 retention sweep. Scoped to
   * the bound org — the sweep runs one `systemScope(orgId, …)` per org.
   * Ordered by id for a deterministic sweep.
   */
  async listSoftDeletedBefore(cutoff: Date): Promise<Document[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        this.scoped(
          documents.orgId,
          and(
            eq(documents.state, "soft_deleted"),
            lt(documents.softDeletedAt, cutoff),
          ),
        ),
      )
      .orderBy(asc(documents.id));
    return rows as Document[];
  }

  /**
   * Draft documents (abandoned/incomplete uploads) older than `cutoff`
   * (`created_at < cutoff`), for the T-010 janitor leg (folds in T-012).
   * A draft has no completed version and no `current_version_id`, so
   * purging it is a plain scoped delete (no forensic row). Scoped; ordered
   * by id.
   */
  async listExpiredDraftsBefore(cutoff: Date): Promise<Document[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        this.scoped(
          documents.orgId,
          and(eq(documents.state, "draft"), lt(documents.createdAt, cutoff)),
        ),
      )
      .orderBy(asc(documents.id));
    return rows as Document[];
  }

  /**
   * Purge an abandoned DRAFT document (T-010 / T-012 janitor). A
   * compare-and-set on `state='draft'`: if the draft was COMPLETED
   * (`markActive`) between the janitor's eligibility read and here — S3
   * multipart uploads live 7 days, well past the 24h draft cutoff, so a
   * stale draft is still completable — this matches zero rows and the
   * now-active document is preserved. A naked delete-by-id would instead
   * destroy the live document with no `document_deletions` forensic row
   * and no S3 tag (the completed object would orphan), so the janitor
   * MUST re-assert the draft state here. Returns the deleted row or `null`.
   */
  async purgeDraft(id: string): Promise<Document | null> {
    const rows = await this.db
      .delete(documents)
      .where(
        this.scoped(
          documents.orgId,
          and(eq(documents.id, id), eq(documents.state, "draft")),
        ),
      )
      .returning();
    return firstOrNull(rows as Document[]);
  }

  /**
   * EVERY document in an Opportunity subroom regardless of state (active,
   * draft, soft-deleted), for the T-010 sweep's archived-opportunity
   * cleanup: all of a 90-day-expired subroom's documents must be
   * hard-deleted before the opportunity row itself (the
   * `documents.opportunity_id` FK is ON DELETE NO ACTION). Unlike
   * `listByOpportunity` (active-only, for listings) this hides nothing.
   * Scoped; ordered by id.
   */
  async listAllByOpportunity(opportunityId: string): Promise<Document[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        this.scoped(
          documents.orgId,
          eq(documents.opportunityId, opportunityId),
        ),
      )
      .orderBy(asc(documents.id));
    return rows as Document[];
  }
}
