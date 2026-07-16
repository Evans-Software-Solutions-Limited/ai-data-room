// Tenant-scoped data access — tenant-isolation (slice 10) / T-002.
//
// The centrepiece of ADR-011's application-layer isolation: a mandatory
// `scopedRepo(orgId)` factory and the `ScopedRepo` base contract every
// tenant-scoped repository extends. Together they make the SAFE path (a
// query that carries `WHERE org_id = $1`) the DEFAULT path — an engineer
// adding a repo in a later slice can only obtain it pre-bound to an org, so
// there is no ergonomic way to write an unscoped query (US2 / FR3).
//
//   - `TenantContext`  — the request-scoped value carrying the caller's
//                        LOCAL org UUID (FR1). Produced from the resolved
//                        actor (see `guards/resolveTenantContext.ts`) or an
//                        explicit `systemScope` (T-003). NEVER defaulted.
//   - `ScopedRepo`     — the base class: takes `orgId` in its constructor
//                        (no default, no setter), injects the predicate on
//                        reads, verifies + stamps `org_id` on writes, and
//                        rebinds onto a transaction via `withTx` (NFR3).
//   - `scopedRepo()`   — the single sanctioned constructor for tenant-scoped
//                        repos. The one audit point ADR-011 asks for; the
//                        CI tripwire (T-005) bans raw access to scoped tables
//                        outside this file + the repo files it owns.
//
// The factory currently exposes only `withTx` — T-004 backfills the slice-1
// tenant-scoped repos (`org_memberships`, `invitations`,
// `external_access_grants`, `audit_events` reads) onto `ScopedRepo` and
// returns their org-bound instances from here; later slices add their own.
//
// NOTE: unlike the illustrative snippet in design.md (`db = defaultDb`), `db`
// is a required argument. Callers already inject the Lambda-cached Drizzle
// handle explicitly (see `application/auth/_shared/deps.ts`); a module-load
// default would force reading `Resource.*` at import time, which breaks the
// unit-test module-mock pattern. Same shape as every existing repo ctor.

import { and, eq, type AnyColumn, type SQL } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";

/**
 * A LOCAL organisation UUID (our `organizations.id`), never the WorkOS text
 * id. Kept as a plain `string` alias — the codebase types `localOrgId` as
 * `string` throughout and this slice deliberately does not introduce a
 * branded type (that would ripple through every actor/repo signature for no
 * isolation win; the guarantee comes from the factory, not the nominal type).
 */
export type OrgId = string;

/**
 * Raised whenever a tenant scope is constructed or used incorrectly: an
 * empty `orgId`, a missing `db` handle, or a write whose explicit `org_id`
 * contradicts the repo's bound org. It always signals a programming error
 * (never user input), so callers should let it surface as a 500 rather than
 * translate it — a swallowed scope error is exactly the class of bug this
 * slice exists to make impossible.
 */
export class ScopedRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopedRepoError";
  }
}

/** Throw unless `orgId` is a non-empty string. Exported so the factory,
 *  the base ctor, and `tenantContext()` share one definition of "valid". */
export function assertOrgId(orgId: OrgId): void {
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new ScopedRepoError("a tenant scope requires a non-empty orgId");
  }
}

/**
 * Request-scoped tenant context (FR1). A small immutable value carrying the
 * caller's local org UUID; it is what a handler passes to `scopedRepo` for
 * the lifetime of a request. Constructed only via `tenantContext()` (which
 * rejects an empty org) or `systemScope` (T-003) — never defaulted, so there
 * is no "ambient all-orgs" state a query could accidentally run under.
 */
export interface TenantContext {
  readonly localOrgId: OrgId;
}

/** Smart constructor for a `TenantContext`; rejects an empty org up front. */
export function tenantContext(localOrgId: OrgId): TenantContext {
  assertOrgId(localOrgId);
  return { localOrgId };
}

/**
 * Base class for every repository over a TENANT_SCOPED table. Concrete repos
 * extend it, call `scoped()` in every read's `WHERE`, `stampOrgId()` on every
 * write, and implement the one-line `withTx`. The `org_id` is baked in at
 * construction and is read-only thereafter — there is deliberately no setter.
 */
export abstract class ScopedRepo {
  protected readonly db: DbOrTx;
  protected readonly orgId: OrgId;

  constructor(db: DbOrTx, orgId: OrgId) {
    assertOrgId(orgId);
    if (!db) {
      throw new ScopedRepoError("a tenant-scoped repo requires a db handle");
    }
    this.db = db;
    this.orgId = orgId;
  }

  /**
   * The org this repo is permanently bound to. Exposed read-only so callers
   * (and the property test) can assert the binding without reaching into
   * protected state; there is no corresponding setter by design.
   */
  get scopeOrgId(): OrgId {
    return this.orgId;
  }

  /**
   * The mandatory read predicate: `org_id = <bound org>`, optionally AND-ed
   * with a repo-specific `extra` clause. Every read method MUST route its
   * `WHERE` through this — that is the injection point ADR-011 relies on and
   * the property test (T-006) proves. Pass the concrete table's `org_id`
   * column (repos own their schema import; the base stays table-agnostic).
   */
  protected scoped(orgColumn: AnyColumn, extra?: SQL): SQL {
    const tenant = eq(orgColumn, this.orgId);
    return extra ? (and(tenant, extra) as SQL) : tenant;
  }

  /**
   * Verify + stamp `org_id` on a write payload. A caller may omit `orgId`
   * entirely (the common case — the scope supplies it, so scoped write inputs
   * usually don't even carry the column) or pass the repo's own org
   * (harmless), but an explicit foreign `org_id` is refused loudly: stamping
   * over it silently would let a caller believe they wrote to org B while the
   * row landed in org A. Returns the payload with `org_id` set to the bound
   * org.
   *
   * `T` is intentionally unconstrained — a scoped input type frequently omits
   * `orgId` altogether, and an all-optional constraint would then reject it
   * (TS2559). We read any incidental `orgId` through a narrow cast instead.
   */
  protected stampOrgId<T>(values: T): T & { orgId: OrgId } {
    const explicit = (values as { orgId?: OrgId | null }).orgId;
    if (explicit != null && explicit !== this.orgId) {
      throw new ScopedRepoError(
        `refusing write: explicit org_id "${explicit}" does not match ` +
          `scoped org "${this.orgId}"`,
      );
    }
    return { ...values, orgId: this.orgId };
  }

  /**
   * Return a same-org instance bound to a transaction handle, so a
   * multi-write sequence inside `db.transaction(...)` stays atomic AND stays
   * scoped (NFR3). Concrete repos implement this as
   * `return new ThisRepo(tx, this.orgId)` — one line, and the scope is
   * preserved by construction.
   */
  abstract withTx(tx: Tx): ScopedRepo;
}

/**
 * The bundle of tenant-scoped repositories returned by `scopedRepo`. T-004
 * populates it with the slice-1 repos and each later slice adds its own; the
 * only member today is `withTx`, which rebinds the WHOLE bundle onto a
 * transaction while preserving the org — the bundle-level counterpart of
 * each repo's `withTx` (NFR3).
 */
export interface ScopedRepos {
  withTx(tx: Tx): ScopedRepos;
}

/**
 * The single sanctioned way to obtain tenant-scoped repositories. Every repo
 * it returns is pre-bound to `orgId`, so application code never handles an
 * unscoped repo over a tenant-scoped table (FR3). Calling it without an
 * `orgId` is a compile-time error (the argument is required) and, as a
 * runtime backstop, an empty org or missing db throws `ScopedRepoError`
 * before any repo is built.
 */
export function scopedRepo(orgId: OrgId, db: DbOrTx): ScopedRepos {
  assertOrgId(orgId);
  if (!db) {
    throw new ScopedRepoError("scopedRepo requires a db handle");
  }
  return {
    // Rebinding onto a tx re-enters the factory with the same org, so the
    // whole bundle stays scoped inside a `db.transaction(...)` callback.
    withTx: (tx) => scopedRepo(orgId, tx),
    // T-004: `membership`, `invitations`, `externalGrants`, `auditReads`, …
  };
}

/**
 * The audit tag every system-initiated operation carries (FR2). `actor` is a
 * fixed literal so a system write can never be mistaken for a user's, and
 * `reason` names the job/webhook that ran — the application layer expands
 * this into an audit event's metadata (see `application/_audit-context.ts`
 * `systemAuditContext`). There is no anonymous system path: a `reason` is
 * mandatory.
 */
export interface SystemAuditTag {
  readonly actor: "system";
  readonly reason: string;
}

/**
 * A tenant scope for an operation with no authenticated actor — a retention
 * sweep, a webhook handler, a cron job. It bundles the same org-bound
 * `ScopedRepos` a request would get with the mandatory system audit tag.
 */
export interface SystemScope {
  readonly orgId: OrgId;
  readonly repos: ScopedRepos;
  readonly audit: SystemAuditTag;
}

/**
 * The ONLY way a system path obtains tenant-scoped repos (FR2). Crucially it
 * still requires a concrete `orgId`: a system job must NAME the org(s) it
 * touches (loop over `systemScope(orgId, …)` per org), because there is
 * deliberately no "all orgs" handle anywhere in this module — an unscoped
 * system read is exactly the cross-tenant hole ADR-011 forbids. `reason` is
 * mandatory so every system access is attributable in the audit trail.
 */
export function systemScope(
  orgId: OrgId,
  db: DbOrTx,
  opts: { reason: string },
): SystemScope {
  assertOrgId(orgId);
  const reason = opts?.reason;
  if (typeof reason !== "string" || reason.length === 0) {
    throw new ScopedRepoError(
      "systemScope requires a non-empty reason naming the job/webhook",
    );
  }
  return {
    orgId,
    repos: scopedRepo(orgId, db),
    audit: { actor: "system", reason },
  };
}
