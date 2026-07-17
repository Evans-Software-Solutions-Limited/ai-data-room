// Shared `DeletionError` → status translation for the room handlers
// that call into `application/room/deletion.ts` (`softDeleteDocument`
// / `restoreDocument` share the same reason union).
//
// room-and-folders (slice 2) / T-011.

import { status } from "elysia";

import { DeletionError } from "../deletion";

export function translateDeletionError(err: unknown) {
  if (!(err instanceof DeletionError)) {
    throw err;
  }
  switch (err.reason) {
    case "not_found":
      return status(404, { ok: false as const, reason: err.reason });
    case "invalid_state":
      return status(409, { ok: false as const, reason: err.reason });
    case "retention_expired":
      return status(409, { ok: false as const, reason: err.reason });
    default:
      throw err;
  }
}
