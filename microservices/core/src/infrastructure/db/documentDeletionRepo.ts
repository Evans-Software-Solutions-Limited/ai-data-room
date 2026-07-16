// Drizzle-backed repository for the `document_deletions` aggregate.
//
// room-and-folders (slice 2) / T-004. Extends `ScopedRepo` (ADR-011):
// scoped reads + org-stamped writes. Constructed only by the `scopedRepo`
// factory; raw access is banned outside this allowlisted file by the CI
// tripwire.
//
// A `document_deletions` row is the audit-adjacent record written when a
// document is hard-deleted (T-009 / retention sweep T-010) — it outlives
// the `documents` row (hence no FK) and stores no filename (no PII). This
// repo is append-only-plus-read: `create` on hard-delete, `listByDocument`
// for forensic reconstruction.

import { asc, eq } from "drizzle-orm";
import type { Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type { DocumentDeletion } from "@ai-data-room/api-utils/schemas/rooms";

import { ScopedRepo } from "./scopedRepoBase";
import { firstOrNull } from "./_helpers";

const { documentDeletions } = schema;

export interface CreateDocumentDeletionInput {
  documentId: string;
  softDeletedBy: string;
}

export class DocumentDeletionRepo extends ScopedRepo {
  withTx(tx: Tx): DocumentDeletionRepo {
    return new DocumentDeletionRepo(tx, this.orgId);
  }

  /** Record a hard-deletion in the bound org. `hard_deleted_at` defaults
   *  to `now()` at the DB. */
  async create(input: CreateDocumentDeletionInput): Promise<DocumentDeletion> {
    const [row] = await this.db
      .insert(documentDeletions)
      .values(this.stampOrgId(input))
      .returning();
    return row as DocumentDeletion;
  }

  /** A single deletion record by id within the bound org, or `null`. */
  async findById(id: string): Promise<DocumentDeletion | null> {
    const rows = await this.db
      .select()
      .from(documentDeletions)
      .where(
        this.scoped(documentDeletions.orgId, eq(documentDeletions.id, id)),
      );
    return firstOrNull(rows as DocumentDeletion[]);
  }

  /**
   * Deletion records for a given document within the bound org, oldest
   * first (forensic reconstruction). Scoped, so a foreign-org
   * `documentId` yields an empty list.
   */
  async listByDocument(documentId: string): Promise<DocumentDeletion[]> {
    const rows = await this.db
      .select()
      .from(documentDeletions)
      .where(
        this.scoped(
          documentDeletions.orgId,
          eq(documentDeletions.documentId, documentId),
        ),
      )
      .orderBy(asc(documentDeletions.hardDeletedAt));
    return rows as DocumentDeletion[];
  }
}
