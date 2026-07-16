// Domain barrel: room aggregates (opportunities + documents).
//
// Pure type re-exports. The canonical zod schemas + inferred types
// live in `@ai-data-room/api-utils/schemas/rooms` (T-002) so the web
// package and core can share a single source of truth without pulling
// core's dependencies into web.
//
// This file is type-only — it has no runtime side effects, hence it
// is excluded from coverage in `vitest.config.ts`. Consumers should
// import as:
//
//   import type { Document, FolderPath } from "@/domain/room";
//
// The runtime `CANONICAL_FOLDERS` const (and the various `*Schema`
// values) are imported directly from
// `@ai-data-room/api-utils/schemas/rooms` where needed — this barrel
// stays type-only. FDP precedent for type-only domain barrels: see
// `microservices/core/src/domain/types/*.ts` in the
// funds-distribution-platform repo.

export type {
  Opportunity,
  OpportunityStatus,
  Document,
  DocumentState,
  DocumentVersion,
  DocumentDeletion,
  FolderKind,
  CanonicalFolder,
  FolderPath,
  MimeType,
  DocumentDTO,
  DocumentVersionDTO,
  OpportunityDTO,
  RoomDTO,
  FolderListingDTO,
} from "@ai-data-room/api-utils/schemas/rooms";
