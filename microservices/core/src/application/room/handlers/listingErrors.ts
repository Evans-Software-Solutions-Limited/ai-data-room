// Shared `ListingError` → status translation for the room handlers
// that call into `application/room/listing.ts#listFolderContents`
// (canonical-folder and opportunity-folder listings share the same
// reason union).
//
// room-and-folders (slice 2) / T-011.

import { status } from "elysia";

import { ListingError } from "../listing";

export function translateListingError(err: unknown) {
  if (!(err instanceof ListingError)) {
    throw err;
  }
  switch (err.reason) {
    case "folder_not_found":
      return status(404, { ok: false as const, reason: err.reason });
    default:
      throw err;
  }
}
