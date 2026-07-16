// Tenant-scoped repo base contract — split out of `scoped.ts` (T-004).
//
// This file exists ONLY to break a circular import: `scoped.ts`'s factory
// needs to import the four concrete repo classes (`MembershipRepo`,
// `InvitationRepo`, `ExternalGrantRepo`, `ScopedAuditReadRepo`) to construct
// them, and those repo classes need `ScopedRepo` (the base they extend).
// If both lived in `scoped.ts`, that would be a same-module cycle:
// `scoped.ts` → repo file → `scoped.ts` for `class X extends ScopedRepo`,
// which is a genuine runtime crash — ESM evaluates a module's imports
// before its own top-level statements (including class declarations) run,
// so the repo file's `extends ScopedRepo` would execute while `ScopedRepo`
// is still in its temporal dead zone (`ReferenceError: Cannot access
// 'ScopedRepo' before initialization`). Verified empirically; this is not
// a style preference.
//
// The fix: this file has ZERO dependency on the repo files or on
// `scoped.ts`, so the repo files can import `ScopedRepo` from HERE with no
// back-edge. `scoped.ts` re-exports everything below (`export * from
// "./scopedRepoBase"`) so its public API — what every other file in the
// codebase imports as `from ".../infrastructure/db/scoped"` — is
// unchanged; nothing outside `infrastructure/db/` needs to know this file
// exists.
//
//   - `TenantContext`  — the request-scoped value carrying the caller's
//                        LOCAL org UUID (FR1). Produced from the resolved
//                        actor (see `guards/resolveTenantContext.ts`) or an
//                        explicit `systemScope` (T-003). NEVER defaulted.
//   - `ScopedRepo`     — the base class: takes `orgId` in its constructor
//                        (no default, no setter), injects the predicate on
//                        reads, verifies + stamps `org_id` on writes, and
//                        rebinds onto a transaction via `withTx` (NFR3).

import { and, eq, type AnyColumn, type SQL } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";

import { recordTenancyGuardViolation } from "../observability/tenancyGuard";

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
      // Defence-in-depth catch (T-007): a write reached us carrying a foreign
      // org_id. Record the P1 signal (metric + structured log → the
      // `tenancy.guard.violations` alarm) BEFORE throwing, so the operator
      // sees it even if something upstream swallows the error.
      recordTenancyGuardViolation({
        boundOrgId: this.orgId,
        attemptedOrgId: explicit,
        // `this` is the concrete subclass (MembershipRepo, InvitationRepo, …),
        // so `constructor.name` names which table's write was refused.
        repo: this.constructor.name,
        operation: "write",
      });
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
