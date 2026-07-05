// Tenant-scoped table registry — tenant-isolation (slice 10) / T-001.
//
// The single source of truth for how each DB table relates to tenancy.
// ADR-011 chose application-layer row-level isolation: a `scopedRepo(orgId)`
// factory (T-002) injects `WHERE org_id = $1`, a CI tripwire (T-005) bans raw
// access to scoped tables, and a property test (T-006) proves no cross-tenant
// leak. All three are driven by these lists, so this file is the contract they
// share.
//
// THREE buckets, not two (see tenant-isolation/design.md §registry) — the
// slice-1 schema audit showed `users` is neither cleanly scoped nor agnostic:
//
//   - TENANT_SCOPED   — carries an `org_id` column → a simple, injectable
//                       `WHERE org_id = $1` predicate isolates it.
//   - TENANT_AGNOSTIC — no `org_id`: the org IS the tenant (`organizations`),
//                       or the row is global infra (`webhook_deliveries`).
//   - IDENTITY        — global identity rows with NO `org_id` column, whose
//                       tenancy is the `org_memberships` EDGE, not a column.
//                       Only `users`. NOT scoped by a row predicate; see the
//                       "Identity & the bootstrap path" note below.
//
// Only tables that EXIST today are listed. Each later slice adds its own
// table(s) here in the same task that adds them to the Drizzle schema — the
// classification test (`__tests__/tenancy.test.ts`) fails CI if a schema table
// is left unclassified or a registry entry names a non-existent table.

/**
 * Tables carrying an `org_id` column. Every read through the scoped factory
 * gets `WHERE org_id = $1`; every write stamps it.
 *
 * NOTE: `audit_events.org_id` is **nullable** — system / no-local-actor events
 * (e.g. `logout` for an unprovisioned user, a `recordCreateOrgFailure` with no
 * org) have a NULL `org_id`. The scoped predicate returns only the caller
 * org's rows and correctly EXCLUDES NULL-org rows; those belong to no tenant
 * and are reachable only under `systemScope` (T-003).
 */
export const TENANT_SCOPED_TABLES = [
  "org_memberships",
  "invitations",
  "external_access_grants",
  "audit_events",
] as const;

/**
 * Tables with no `org_id`: either the org itself (`organizations` — the org IS
 * the tenant; id lookups are still constrained to the caller's own org at the
 * application layer) or global infrastructure (`webhook_deliveries`).
 */
export const TENANT_AGNOSTIC_TABLES = [
  "organizations",
  "webhook_deliveries",
] as const;

/**
 * Identity tables: global rows with NO `org_id`. Tenancy is the
 * `org_memberships` edge, not a column.
 *
 * `users` is here because (a) it has no `org_id` (verified against
 * `packages/db/src/schema/auth.ts`), (b) a user can have ZERO orgs — the
 * lazy-mirror state (`/me` → `{ orgId: null }` pre-org-creation) and external
 * users (grants, not memberships) — and (c) `userRepo`'s lookups
 * (`findByWorkosUserId`/`findById`) run inside `resolveActor` BEFORE any tenant
 * context exists: you need the user row to discover the org. So `userRepo`
 * stays an unscoped identity repo and is NOT exported from `scopedRepo`. "The
 * users IN org A" is a tenant question answered by the scoped membership repo
 * (a join from the membership edge), never by reading `users` directly.
 */
export const IDENTITY_TABLES = ["users"] as const;

export type TenantScopedTable = (typeof TENANT_SCOPED_TABLES)[number];
export type TenantAgnosticTable = (typeof TENANT_AGNOSTIC_TABLES)[number];
export type IdentityTable = (typeof IDENTITY_TABLES)[number];

/** Every classified table name, across all three buckets. */
export const ALL_CLASSIFIED_TABLES = [
  ...TENANT_SCOPED_TABLES,
  ...TENANT_AGNOSTIC_TABLES,
  ...IDENTITY_TABLES,
] as const;

const SCOPED = new Set<string>(TENANT_SCOPED_TABLES);

/** True if `table` carries an `org_id` and must flow through `scopedRepo`. */
export function isTenantScoped(table: string): boolean {
  return SCOPED.has(table);
}
