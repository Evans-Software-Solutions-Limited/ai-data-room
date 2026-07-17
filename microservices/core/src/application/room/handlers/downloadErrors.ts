// Shared `DownloadError` → status translation for the room handlers
// that call into `application/room/download.ts` (`getDocument` /
// `listVersions` share the same reason union).
//
// room-and-folders (slice 2) / T-011.

import { status } from "elysia";

import { DownloadError } from "../download";

export function translateDownloadError(err: unknown) {
  if (!(err instanceof DownloadError)) {
    throw err;
  }
  switch (err.reason) {
    case "not_found":
      return status(404, { ok: false as const, reason: err.reason });
    case "version_not_found":
      return status(404, { ok: false as const, reason: err.reason });
    default:
      throw err;
  }
}
