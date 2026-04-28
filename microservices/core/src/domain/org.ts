// Domain barrel: organization aggregate.
//
// Pure type re-exports. The canonical zod schemas + inferred types
// live in `@ai-data-room/api-utils/schemas/auth-orgs` (T-004) so the
// web package and core can share a single source of truth without
// pulling core's dependencies into web.
//
// This file is type-only — it has no runtime side effects, hence it
// is excluded from coverage in `vitest.config.ts`. Consumers should
// import as:
//
//   import type { Org, Role } from "@/domain/org";
//
// (or whatever path alias core resolves to). FDP precedent for
// type-only domain barrels: see `microservices/core/src/domain/types/*.ts`
// in the funds-distribution-platform repo.

export type {
  Org,
  OrgMembership,
  Role,
  LifecycleState,
} from "@ai-data-room/api-utils/schemas/auth-orgs";
