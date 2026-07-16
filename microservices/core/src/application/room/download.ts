// Application-layer document download + version history — room-and-folders
// (slice 2) / T-008.
//
// Covers FR14 (download the current or a specific past version) and FR15
// (version history), FR16 (a presigned URL expires quickly — 5 minutes),
// FR19 (audit every download). A soft- or hard-deleted document, or an
// unknown/foreign-org id, is uniformly `not_found` — a client can't
// distinguish "never existed" from "deleted", matching the listing path's
// hidden-archived-subroom shape (`listing.ts`).

import type {
  DocumentDTO,
  DocumentVersion,
  DocumentVersionDTO,
} from "@ai-data-room/api-utils/schemas/rooms";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { DocumentRepo } from "../../infrastructure/db/documentRepo";
import type { DocumentVersionRepo } from "../../infrastructure/db/documentVersionRepo";
import type { OpportunityRepo } from "../../infrastructure/db/opportunityRepo";
import type { S3DocumentStore } from "../../infrastructure/s3/client";

import { type AuditContext, safeAudit } from "../_audit-context";

import { toDocumentDTO, toDocumentVersionDTO } from "./dto";

/** Presigned download URL TTL (FR16) — kept short so a leaked/shared link
 *  goes stale quickly. */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type DownloadErrorReason =
  /** Document unknown, foreign-org, or not `active` (soft/hard-deleted —
   *  FR15: hard-deleted docs don't appear at all). */
  | "not_found"
  /** `versionId` doesn't name a version of THIS document (foreign,
   *  wrong-document, or unknown). */
  | "version_not_found";

export class DownloadError extends Error {
  public readonly reason: DownloadErrorReason;
  constructor(reason: DownloadErrorReason) {
    super(reason);
    this.name = "DownloadError";
    this.reason = reason;
  }
}

/**
 * Presign a download URL for one version's S3 object (FR14/FR16). Exported
 * standalone (not just used internally by `getDocument`) for reuse by
 * access-control's download revalidator (design T-008 note) — that flow
 * re-checks a grant and then needs the same presign, without going through
 * `getDocument`'s document/DTO resolution.
 */
export function presignDocumentDownload(
  store: S3DocumentStore,
  version: DocumentVersion,
  ttlSeconds: number = DOWNLOAD_URL_TTL_SECONDS,
): Promise<string> {
  return store.presignDownloadUrl(version.s3Key, {
    versionId: version.s3VersionId ?? undefined,
    ttlSeconds,
  });
}

// ---------------------------------------------------------------------------
// getDocument
// ---------------------------------------------------------------------------

export interface GetDocumentInput {
  documentId: string;
  /** Omit to serve the document's current version. */
  versionId?: string;
  actorUserId: string;
  audit: AuditContext;
}

export interface GetDocumentDeps {
  documents: DocumentRepo;
  documentVersions: DocumentVersionRepo;
  opportunities: OpportunityRepo;
  store: S3DocumentStore;
  auditRepo: AuditRepo;
}

export interface GetDocumentResult {
  document: DocumentDTO;
  downloadUrl: string;
}

export async function getDocument(
  input: GetDocumentInput,
  deps: GetDocumentDeps,
): Promise<GetDocumentResult> {
  // NOTE: this gates on the DOCUMENT's state only, not the parent
  // Opportunity's. A document in an ARCHIVED subroom stays fetchable by id
  // here — by design: archive "hides from navigation" (FR6, enforced by
  // `listFolderContents`) and revokes external grants, but the documents
  // are RETAINED (90 days) and remain reachable to authorised internal
  // callers. Who may call this at all is access-control's job (FR14 —
  // primitive trusts the middleware; slice 3 wires `requires(...)`).
  const dwcv = await deps.documents.getWithCurrentVersion(input.documentId);
  if (!dwcv || dwcv.document.state !== "active") {
    // Unknown, foreign-org, draft, soft-deleted, or (were the row still
    // reachable) hard-deleted — all hidden the same way (FR15).
    throw new DownloadError("not_found");
  }

  let versionToServe: DocumentVersion;
  if (input.versionId) {
    const v = await deps.documentVersions.findById(input.versionId);
    if (!v || v.documentId !== input.documentId) {
      throw new DownloadError("version_not_found");
    }
    versionToServe = v;
  } else {
    // An active document always has a current version (`markActive` sets
    // it atomically with the transition) — the `!` reflects that invariant,
    // not an assumption; `toDocumentDTO` below throws loudly if it's ever
    // violated.
    versionToServe = dwcv.currentVersion!;
  }

  // Resolve the opportunity slug for the DTO's folder shape — only needed
  // for an opportunity-folder document; a canonical one carries no
  // opportunityId to look up.
  let opportunitySlug: string | undefined;
  if (dwcv.document.folderKind === "opportunity") {
    const opp = await deps.opportunities.findById(dwcv.document.opportunityId!);
    // Should exist (documents don't outlive their opportunity row); if it
    // somehow doesn't, `toDocumentDTO` throws below rather than silently
    // rendering a folder with an undefined slug.
    opportunitySlug = opp?.slug;
  }

  const downloadUrl = await presignDocumentDownload(deps.store, versionToServe);

  await safeAudit(deps, {
    eventType: "file_downloaded",
    outcome: "success",
    actorUserId: input.actorUserId,
    orgId: deps.documents.scopeOrgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      documentId: input.documentId,
      versionId: versionToServe.id,
      versionNumber: versionToServe.versionNumber,
    },
  });

  return {
    // The DTO always shows the CURRENT version (not necessarily the one
    // served) — `downloadUrl` points at the requested version, which may be
    // an older one than `document.currentVersion`.
    document: toDocumentDTO(
      dwcv.document,
      dwcv.currentVersion,
      opportunitySlug,
    ),
    downloadUrl,
  };
}

// ---------------------------------------------------------------------------
// listVersions
// ---------------------------------------------------------------------------

export interface ListVersionsInput {
  documentId: string;
}

export interface ListVersionsDeps {
  documents: DocumentRepo;
  documentVersions: DocumentVersionRepo;
}

/** Version history (FR15), oldest-first (the repo's default order). A
 *  hard-deleted document doesn't appear at all (its row is gone); a
 *  soft-deleted or unknown/foreign-org one is `not_found`. Read-only — no
 *  audit emission. */
export async function listVersions(
  input: ListVersionsInput,
  deps: ListVersionsDeps,
): Promise<DocumentVersionDTO[]> {
  const doc = await deps.documents.findById(input.documentId);
  if (!doc || doc.state !== "active") {
    throw new DownloadError("not_found");
  }
  const versions = await deps.documentVersions.listByDocument(input.documentId);
  return versions.map(toDocumentVersionDTO);
}
