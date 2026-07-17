// Upload orchestration — room-and-folders (slice 2), T-014.
//
// The client side of the presigned-multipart-part transport (see
// `microservices/core/src/application/room/upload.ts` for the server
// side): initiate (eden) → PUT each part directly to S3 via its
// presigned URL (plain `fetch`, NOT eden — a presigned URL must not
// carry our session cookie) → complete (eden). On any failure at/after
// initiate, best-effort abort (eden) before rethrowing, so an abandoned
// draft document / S3 multipart doesn't linger past the janitor's sweep.
//
// Chunking uses the SAME `UPLOAD_PART_SIZE` the server presigned exactly
// `ceil(sizeBytes / UPLOAD_PART_SIZE)` URLs for (min 1) — see the T-014
// build spec's "Step 0" reconciliation for why that constant now lives
// in `@ai-data-room/api-utils/schemas/rooms` rather than only on the
// server.

import {
  MimeTypeEnum,
  UPLOAD_PART_SIZE,
  type CanonicalFolder,
} from "@ai-data-room/api-utils/schemas/rooms";

import type { api } from "@/lib/eden";

export type UploadTargetInput =
  | { kind: "canonical"; folder: CanonicalFolder }
  | { kind: "opportunity"; opportunityId: string };

export type UploadFailureReason =
  | "unsupported_type"
  | "initiate_failed"
  | "part_upload_failed"
  | "complete_failed"
  | "canceled";

export class UploadClientError extends Error {
  reason: UploadFailureReason;

  constructor(reason: UploadFailureReason, message?: string) {
    super(message ?? reason);
    this.name = "UploadClientError";
    this.reason = reason;
  }
}

export interface UploadFileDeps {
  /** Injectable for tests — the real caller passes `@/lib/eden`'s `api`. */
  api: typeof api;
  /** Defaults to global `fetch`; injectable for tests. */
  fetchImpl?: typeof fetch;
  onProgress?: (bytesUploaded: number) => void;
  signal?: AbortSignal;
}

export interface UploadFileParams {
  orgId: string;
  target: UploadTargetInput;
  file: File;
}

export interface UploadFileResult {
  documentId: string;
  versionId: string;
  versionNumber: number;
}

const SUPPORTED_MIME_TYPES: readonly string[] = MimeTypeEnum.options;

/** Best-effort — a reason string from an eden error body when present,
 *  otherwise `undefined`. Swallows anything malformed; this is only used
 *  to enrich a human-readable error message, never for control flow. */
function reasonFromEdenError(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "value" in error &&
    error.value &&
    typeof error.value === "object" &&
    "reason" in error.value
  ) {
    return String((error.value as { reason: unknown }).reason);
  }
  return undefined;
}

export async function uploadFile(
  params: UploadFileParams,
  deps: UploadFileDeps,
): Promise<UploadFileResult> {
  const { orgId, target, file } = params;
  const fetchImpl = deps.fetchImpl ?? fetch;

  // 1. Client mime pre-check — fast, friendly failure before any network
  // call. The backend re-validates regardless (FR9); this is UX only.
  if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
    throw new UploadClientError("unsupported_type");
  }

  // 2. initiate.
  //
  // Reconciliation (flagged in the PR): Eden Treaty infers this route's
  // `mimeType` body field as `never`, not the literal union it actually
  // is. Root cause (confirmed via an isolated repro against a minimal
  // Elysia + eden app): `postUploadInitiateHandler.ts` builds the schema
  // as `t.Union(MimeTypeEnum.options.map(t.Literal))` — `.map()` over a
  // const tuple returns a plain (non-tuple) array type, and Eden's
  // internal `Replace<Body, Blob | Blob[], Files>` mapped type (in
  // `@elysiajs/eden`'s `treaty/types.d.ts`) collapses that specific
  // field to `never` when the union was constructed from an array rather
  // than an explicit literal tuple (`t.Union([t.Literal(...), ...])`
  // resolves correctly). Every OTHER field on this body — including the
  // `target` discriminated union — resolves correctly. Casting just the
  // one poisoned field to `never` (always a legal assertion — `never` is
  // a subtype of everything) is the minimal, purely client-side fix;
  // it doesn't touch runtime behaviour or the wire payload. The
  // alternative (reworking the handler's schema to build a genuine
  // literal tuple, or pulling `@sinclair/typebox` into the web workspace
  // to write a precisely-typed wrapper) is a bigger change than this
  // task's scope — flagged for a follow-up rather than done here.
  const initiateRes = await deps.api.core
    .orgs({ orgId })
    .uploads.initiate.post({
      target:
        target.kind === "canonical"
          ? { kind: "canonical", folder: target.folder }
          : { kind: "opportunity", opportunityId: target.opportunityId },
      filename: file.name,
      mimeType: file.type as never,
      sizeBytes: file.size,
    });

  if (initiateRes.status !== 201 || !initiateRes.data) {
    throw new UploadClientError(
      "initiate_failed",
      reasonFromEdenError(initiateRes.error),
    );
  }

  const { uploadId, documentId, versionId, parts } = initiateRes.data;

  // 3-4. PUT each part, then complete — any failure past this point has a
  // ticket to abort.
  try {
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const collectedParts: { partNumber: number; eTag: string }[] = [];
    let bytesUploaded = 0;

    for (const part of sortedParts) {
      if (deps.signal?.aborted) {
        throw new UploadClientError("canceled");
      }

      const start = (part.partNumber - 1) * UPLOAD_PART_SIZE;
      const end = start + UPLOAD_PART_SIZE;
      const blob = file.slice(start, end);

      const put = await fetchImpl(part.url, {
        method: "PUT",
        body: blob,
        signal: deps.signal,
      });

      if (!put.ok) {
        throw new UploadClientError("part_upload_failed");
      }
      const eTag = put.headers.get("ETag");
      if (!eTag) {
        throw new UploadClientError("part_upload_failed");
      }

      bytesUploaded += blob.size;
      deps.onProgress?.(bytesUploaded);
      collectedParts.push({ partNumber: part.partNumber, eTag });
    }

    const completeRes = await deps.api.core
      .orgs({ orgId })
      .uploads({ uploadId })
      .complete.post({ documentId, versionId, parts: collectedParts });

    if (completeRes.status !== 200 || !completeRes.data) {
      throw new UploadClientError(
        "complete_failed",
        reasonFromEdenError(completeRes.error),
      );
    }

    return completeRes.data;
  } catch (err) {
    // Best-effort cleanup — swallow any abort failure (the multipart may
    // already be gone, or the abort call itself may have been aborted by
    // the same signal). The original error is what the caller needs.
    try {
      await deps.api.core
        .orgs({ orgId })
        .uploads({ uploadId })
        .delete({ documentId, versionId });
    } catch {
      // best-effort — nothing more to do.
    }
    // If the caller aborted, the failure IS a cancellation regardless of
    // how it surfaced: a between-parts abort throws our `canceled` above,
    // but an abort DURING an in-flight part PUT rejects `fetch` with a
    // DOMException `AbortError` — normalise both to `canceled` so the UI
    // shows "Canceled", not a generic upload error.
    if (deps.signal?.aborted) {
      throw new UploadClientError("canceled");
    }
    throw err;
  }
}
