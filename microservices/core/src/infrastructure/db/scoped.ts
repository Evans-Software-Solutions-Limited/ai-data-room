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
// `ScopedRepo` + its supporting primitives (`OrgId`, `ScopedRepoError`,
// `assertOrgId`, `TenantContext`, `tenantContext`) live in
// `scopedRepoBase.ts`, not here, and are re-exported below unchanged — see
// that file's header for why: this factory has to import the four concrete
// repo classes to construct them, and those repo classes have to import
// `ScopedRepo` to extend it, so keeping both directions in one file is a
// circular import that crashes at runtime (`class X extends ScopedRepo`
// evaluates before this module's own top-level statements do). Every
// existing import of `from ".../infrastructure/db/scoped"` is unaffected —
// this module still re-exports the full public surface.
//
// T-004 backfilled the slice-1 tenant-scoped repos (`org_memberships`,
// `invitations`, `external_access_grants`, `audit_events` reads) onto
// `ScopedRepo`; the factory below returns their org-bound instances as
// `membership` / `invitations` / `externalGrants` / `auditReads`. Later
// slices add their own members to the same bundle.
//
// NOTE: unlike the illustrative snippet in design.md (`db = defaultDb`), `db`
// is a required argument. Callers already inject the Lambda-cached Drizzle
// handle explicitly (see `application/auth/_shared/deps.ts`); a module-load
// default would force reading `Resource.*` at import time, which breaks the
// unit-test module-mock pattern. Same shape as every existing repo ctor.

import type { DbOrTx, Tx } from "@ai-data-room/db";

// T-004: importing the concrete repo files here is infra-importing-infra,
// which is fine — `scoped.ts` already documents (see `tenancy.ts` / FR6)
// that it and the repo files it owns are the CI tripwire's carve-out from
// "no raw access to a tenant-scoped table outside the factory".
import { ScopedAuditReadRepo } from "./auditRepo";
import { ExternalGrantRepo } from "./externalGrantRepo";
import { InvitationRepo } from "./invitationRepo";
import { MembershipRepo } from "./membershipRepo";
import { assertOrgId, ScopedRepoError, type OrgId } from "./scopedRepoBase";

export * from "./scopedRepoBase";

/**
 * The bundle of tenant-scoped repositories returned by `scopedRepo`. T-004
 * populates it with the slice-1 repos; each later slice adds its own member
 * to the same bundle. `withTx` rebinds the WHOLE bundle onto a transaction
 * while preserving the org — the bundle-level counterpart of each repo's
 * own `withTx` (NFR3).
 */
export interface ScopedRepos {
  readonly membership: MembershipRepo;
  readonly invitations: InvitationRepo;
  readonly externalGrants: ExternalGrantRepo;
  readonly auditReads: ScopedAuditReadRepo;
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
    membership: new MembershipRepo(db, orgId),
    invitations: new InvitationRepo(db, orgId),
    externalGrants: new ExternalGrantRepo(db, orgId),
    auditReads: new ScopedAuditReadRepo(db, orgId),
    // Rebinding onto a tx re-enters the factory with the same org, so the
    // whole bundle stays scoped inside a `db.transaction(...)` callback.
    withTx: (tx) => scopedRepo(orgId, tx),
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
