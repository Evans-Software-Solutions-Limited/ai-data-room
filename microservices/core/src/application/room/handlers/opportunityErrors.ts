// Shared `OpportunityError` → status translation for the room
// handlers that call into `application/room/opportunities.ts`
// (create / rename / archive all share the same reason union).
//
// room-and-folders (slice 2) / T-011. Kept in one place — same
// spirit as `dto.ts`'s single DTO-mapper point — so the three
// mutation handlers below don't drift on which reason maps to which
// status code.

import { status } from "elysia";

import { OpportunityError } from "../opportunities";

export function translateOpportunityError(err: unknown) {
  if (!(err instanceof OpportunityError)) {
    throw err;
  }
  switch (err.reason) {
    case "invalid_slug":
      return status(400, { ok: false as const, reason: err.reason });
    case "slug_taken":
      return status(409, { ok: false as const, reason: err.reason });
    case "not_found":
      return status(404, { ok: false as const, reason: err.reason });
    case "already_archived":
      return status(409, { ok: false as const, reason: err.reason });
    default:
      throw err;
  }
}
