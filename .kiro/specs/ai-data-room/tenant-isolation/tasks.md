# Tasks — ai-data-room / tenant-isolation

**Status:** complete — T-001–T-008 shipped; ADR-011 `accepted`. One tracked
follow-up (T-009, FR8 audit emission). Sign-off:
[docs/slices/tenant-isolation.md](../../../docs/slices/tenant-isolation.md).
**Design:** [./design.md](./design.md)
**Last updated:** 2026-07-16

Assumes `auth-and-orgs` is merged. Executes inside `microservices/core`
(`infrastructure/db/*`) and `packages/db`. Lands **before**
`room-and-folders`' document-bearing tasks (T-006 onward) — see the
implementation plan. ADR-011 must be `accepted` before T-006 of this slice.

## Conventions

Same as `auth-and-orgs/tasks.md` (Bun + Turborepo, Vitest, integration tests
via the existing Docker compose, layered architecture, 90% coverage gate).

---

## T-001 — Audit: confirm `org_id` on every tenant-scoped table

Status: `[x]` (merged PR #42 — `infrastructure/db/tenancy.ts` registry + classification test)
**Scope:** Enumerate current tables; classify each into the **three** buckets
(design §registry): `TENANT_SCOPED_TABLES` (carries `org_id`),
`TENANT_AGNOSTIC_TABLES` (no `org_id`; org-is-tenant or global infra), and
`IDENTITY_TABLES` (`users` — global identity, tenancy via the
`org_memberships` edge, no `org_id` column). Confirm each scoped table actually
carries `org_id`; note `audit_events.org_id` is nullable. Flag any table that
_should_ be scoped but lacks a usable `org_id`.
**Files (likely):** `microservices/core/src/infrastructure/db/tenancy.ts`.
**DoD:** Registry committed (three lists); any gap documented (migration
deferred to T-002 only if found).
**Tests required:** Unit test asserting every Drizzle table is classified in
**exactly one** of the three registry lists (no unclassified, no duplicate).

---

## T-002 — `scopedRepo(orgId)` factory + TenantContext

Status: `[x]` (merged PR #45 — `infrastructure/db/scoped.ts` `ScopedRepo` base + `scopedRepo`/`tenantContext` factory; `resolveTenantContext` guard mounted in `orgScopedRoutes`)
**Scope:** Implement `TenantContext` (request-scoped `localOrgId`) and the
`scopedRepo(orgId, db)` factory. Define the scoped-repo base contract:
constructor takes `orgId`, reads inject the predicate, writes stamp + verify
`org_id`, `withTx(tx)` returns a same-org txn-bound instance.
**Files (likely):** `infrastructure/db/scoped.ts`,
`application/auth/guards/*` (context wiring).
**DoD:** Factory returns only tenant-scoped repos; constructing one without an
`orgId` is a compile-time error.
**Tests required:** Unit — predicate injected on reads; write rejects a
mismatched explicit `org_id`; `withTx` preserves scope.

---

## T-003 — `systemScope(orgId)` + audited system path

Status: `[x]` (merged PR #46 — `systemScope` in `scoped.ts` + `systemAuditContext` in `_audit-context.ts`)
**Scope:** Explicit system-scope constructor for jobs/webhooks with an audit
tag `{ actor: 'system', reason }`. No implicit all-orgs handle.
**Files (likely):** `infrastructure/db/scoped.ts`,
`application/_audit-context.ts`.
**DoD:** Retention-sweep / webhook callers can name an org; audit event carries
the system tag.
**Tests required:** Unit — system scope stamps the audit tag; no default-all
path exists.

---

## T-004 — Backfill `auth-and-orgs` repos onto the factory

Status: `[x]` (merged PR #47 — 4 repos onto `ScopedRepo`; `resolveScopedRepos` guard injects `ctx.scoped`; `bootstrapRepo.ts` carve-out; `tenantScoping.integration.test.ts` regression)
**Scope:** Route the existing **tenant-scoped** repositories (`membershipRepo`,
`invitationRepo`, `externalGrantRepo`, `auditRepo` reads) through `scopedRepo`.
**`userRepo` is exempt** (identity table, no `org_id`, used by the pre-tenancy
`resolveActor` bootstrap — see design §"Identity & the bootstrap path"); keep
`orgRepo`, `webhookDeliveryRepo` tenant-agnostic.
**Files (likely):** `infrastructure/db/*Repo.ts`, callers in `application/*`.
**DoD:** Slice-1 unit + integration suites stay green; no behaviour change.
**Tests required:** Existing suites pass; add a regression that a slice-1 read
is org-scoped.

---

## T-005 — CI tripwire: ban raw access to tenant-scoped tables

Status: `[x]` (merged PR #48 — `security/__tests__/tenancy-guard.test.ts`, registry-driven, self-tested + real-tree revert-checked)
**Scope:** A test mirroring `security/__tests__/nfr-matrix.test.ts` that fails
if any tenant-scoped table name is accessed via raw `db`/Drizzle outside the
factory + its owned repo files.
**Files (likely):** `microservices/core/src/security/__tests__/tenancy-guard.test.ts`.
**DoD:** A deliberately-introduced raw unscoped query fails the test; removing
it passes.
**Tests required:** The tripwire itself (self-testing via a fixture).

---

## T-006 — Property test: no cross-tenant leak

Status: `[x]` (merged PR #49 — `tenantIsolation.property.integration.test.ts` (fast-check, real Postgres); ADR-011 flipped to `accepted`)
**Scope:** `fast-check` property test over a real test Postgres: two orgs,
random row distributions, every repo method invoked under one org's scope,
assert zero foreign-org rows. ADR-011 moves to `accepted` on green.
**Files (likely):** `infrastructure/db/__tests__/tenant-isolation.property.test.ts`.
**DoD:** Test wired into CI; shrinking reports the minimal case on failure.
**Tests required:** This is the test.

---

## T-007 — Observability: guard violation metric + alert

Status: `[x]` (merged PR #50 — `tenancy.guard.violations` metric + structured log in `infrastructure/observability/tenancyGuard.ts`, emitted from `ScopedRepo.stampOrgId`; `alarm-tenancy-guard-violations` (`> 0 over 5min`) in `infra/observability.ts`)
**Scope:** `tenancy.guard.violations` metric + structured log on a
defence-in-depth catch; alarm `> 0 over 5min`.
**Files (likely):** `infrastructure/observability/metrics.ts`, `infra/*`.
**DoD:** Metric emits on a forced violation in a test; alarm wired in infra.
**Tests required:** Unit — metric emitted on guard catch.

---

## T-008 — Slice sign-off + ADR-011 acceptance

Status: `[x]` (this PR — [docs/slices/tenant-isolation.md](../../../docs/slices/tenant-isolation.md) traceability matrix; ADR-011 already flipped to `accepted` in T-006/#49; `room-and-folders` document tasks confirmed unblocked)
**Scope:** Traceability matrix (FR/NFR/AC → impl → test), flip ADR-011 to
`accepted`, tag. Confirm `room-and-folders` document tasks are now unblocked.
**Files (likely):** `docs/slices/tenant-isolation.md`,
`adr/011-multi-tenant-isolation.md`.
**DoD:** Matrix complete; ADR accepted; sign-off doc merged.
**Tests required:** None (docs); CI green across the slice.
**Note:** `release-please` owns the version tag; Brad tags the slice release
when cutting it (not pushed from this task).

---

## T-009 — FR8: audit event on a caught tenancy violation (follow-up)

Status: `[ ]`
**Scope:** Complete FR8. T-007 shipped the runtime operator signal (metric +
log + `> 0` alarm) at the `ScopedRepo.stampOrgId` catch, but the FR8
**audit event** (via the `auth-and-orgs` audit writer, tagged as a potential
isolation violation, carrying actor/request context) is deferred: `stampOrgId`
is infrastructure and must not import the application-layer audit writer.
Emit it at the application/handler error boundary that catches
`ScopedRepoError` (with actor context), plus the webhook Lambda's existing
catch. Add `tenancy_violation` to `AuditEventTypeSchema` when the emission
lands (not before — avoid a dead enum value).
**Files (likely):** `application/audit.ts` (enum), an Elysia `.onError`
boundary + `handlers/webhooks/*`, `packages/api-utils/.../auth-orgs.ts`.
**DoD:** A forced `ScopedRepoError` on a request/webhook path writes a
`tenancy_violation` audit row via `safeAudit` with the actor + attempted org.
**Tests required:** Unit — the boundary emits the audit event on a caught
`ScopedRepoError`; no dead enum value ships ahead of the emission.
**Why deferred:** the FR8 trigger is a should-never-happen programming bug
already covered operationally by the T-007 alarm; the clean emission point is
cross-cutting (request + webhook boundaries) and out of T-007's metric/log
scope. Surfaced by the T-007 pre-PR review; tracked here so sign-off (T-008)
records FR8 as partial-with-owner rather than silently unmet.
