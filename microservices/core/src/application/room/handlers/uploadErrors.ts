// Shared `UploadError` → status translation for the room handlers
// that call into `application/room/upload.ts` (`initiateUpload` /
// `completeUpload` / `abortUpload` share the same reason union, each
// only ever throwing a subset of it).
//
// room-and-folders (slice 2) / T-011.

import { status } from "elysia";

import { UploadError } from "../upload";

export function translateUploadError(err: unknown) {
  if (!(err instanceof UploadError)) {
    throw err;
  }
  switch (err.reason) {
    case "folder_not_found":
      return status(404, { ok: false as const, reason: err.reason });
    case "not_found":
      return status(404, { ok: false as const, reason: err.reason });
    case "invalid_state":
      return status(409, { ok: false as const, reason: err.reason });
    case "too_large":
      return status(413, { ok: false as const, reason: err.reason });
    case "conflict":
      return status(409, { ok: false as const, reason: err.reason });
    case "activation_failed":
      return status(409, { ok: false as const, reason: err.reason });
    default:
      throw err;
  }
}
