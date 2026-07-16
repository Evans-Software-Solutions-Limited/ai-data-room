// Application-layer room + folder listing — room-and-folders (slice 2) /
// T-008.
//
// Covers FR7 (room overview: canonical folders + live opportunities) and
// the folder-contents read (canonical folder or Opportunity subroom),
// FR19 (audit every folder listing). Archived subrooms are hidden from
// folder-contents (FR6) — an id naming an archived (or foreign-org, or
// unknown) opportunity is indistinguishable `folder_not_found`, matching
// the upload path's `UploadError` shape (`upload.ts`).
//
// Uses the `*WithVersion` repo methods (`documentRepo.ts`) to avoid an N+1
// over up to 500 documents in one folder (NFR4).

import {
  CANONICAL_FOLDERS,
  type CanonicalFolder,
  type FolderListingDTO,
  type RoomDTO,
} from "@ai-data-room/api-utils/schemas/rooms";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { DocumentRepo } from "../../infrastructure/db/documentRepo";
import type { OpportunityRepo } from "../../infrastructure/db/opportunityRepo";

import { type AuditContext, safeAudit } from "../_audit-context";

import { toDocumentDTO, toOpportunityDTO } from "./dto";

export type ListingErrorReason =
  /** The opportunity target is unknown, foreign-org, or archived —
   *  archived subrooms are hidden from folder-contents (FR6). */
  "folder_not_found";

export class ListingError extends Error {
  public readonly reason: ListingErrorReason;
  constructor(reason: ListingErrorReason) {
    super(reason);
    this.name = "ListingError";
    this.reason = reason;
  }
}

/** Which folder's contents to list — a canonical folder, or an Opportunity
 *  subroom by id. */
export type FolderTarget =
  | { kind: "canonical"; folder: CanonicalFolder }
  | { kind: "opportunity"; opportunityId: string };

// ---------------------------------------------------------------------------
// getRoom
// ---------------------------------------------------------------------------

export interface GetRoomDeps {
  opportunities: OpportunityRepo;
}

/** `GET /rooms` (design "room overview", FR7): the seven canonical folders
 *  plus the org's live Opportunity subrooms. Read-only — no audit emission
 *  (not in FR19's mutation list, same as `listOpportunities`). */
export async function getRoom(deps: GetRoomDeps): Promise<RoomDTO> {
  const opportunities = await deps.opportunities.listActive();
  return {
    folders: [...CANONICAL_FOLDERS],
    opportunities: opportunities.map(toOpportunityDTO),
  };
}

// ---------------------------------------------------------------------------
// listFolderContents
// ---------------------------------------------------------------------------

export interface ListFolderContentsInput {
  target: FolderTarget;
  actorUserId: string;
  audit: AuditContext;
}

export interface ListFolderContentsDeps {
  documents: DocumentRepo;
  opportunities: OpportunityRepo;
  auditRepo: AuditRepo;
}

export async function listFolderContents(
  input: ListFolderContentsInput,
  deps: ListFolderContentsDeps,
): Promise<FolderListingDTO> {
  const { target } = input;

  let documentDTOs: FolderListingDTO["documents"];
  let metadata: Record<string, unknown>;

  if (target.kind === "canonical") {
    const rows = await deps.documents.listByCanonicalFolderWithVersion(
      target.folder,
    );
    documentDTOs = rows.map((row) =>
      toDocumentDTO(row.document, row.currentVersion),
    );
    metadata = { folder: target.folder, count: documentDTOs.length };
  } else {
    const opp = await deps.opportunities.findById(target.opportunityId);
    if (!opp || opp.status !== "active") {
      // Archived subrooms are hidden (FR6) — indistinguishable from an
      // unknown/foreign-org id, matching the upload path's UploadError
      // shape for the same target kind.
      throw new ListingError("folder_not_found");
    }
    const rows = await deps.documents.listByOpportunityWithVersion(opp.id);
    documentDTOs = rows.map((row) =>
      toDocumentDTO(row.document, row.currentVersion, opp.slug),
    );
    metadata = {
      opportunityId: target.opportunityId,
      count: documentDTOs.length,
    };
  }

  await safeAudit(deps, {
    eventType: "folder_listed",
    outcome: "success",
    actorUserId: input.actorUserId,
    orgId: deps.documents.scopeOrgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata,
  });

  return { documents: documentDTOs };
}
