# Tasks — ai-data-room / tenant-isolation

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-31

Assumes `auth-and-orgs` is merged. Executes inside `microservices/core`
(`infrastructure/db/*`) and `packages/db`. Lands **before**
`room-and-folders`' document-bearing tasks (T-006 onward) — see the
implementation plan. ADR-011 must be `accepted` before T-006 of this slice.

## Conventions

Same as `auth-and-orgs/tasks.md` (Bun + Turborepo, Vitest, integration tests
via the existing Docker compose, layered architecture, 90% coverage gate).

---

## T-001 — Audit: confirm `org_id` on every tenant-scoped table

Status: `[ ]`
**Scope:** Enumerate current tenant-scoped tables; confirm each carries
`org_id` (directly or via FK). Produce the `TENANT_SCOPED_TABLES` /
`TENANT_AGNOSTIC_TABLES` registry content. Flag any scoped table missing a
usable `org_id`.
**Files (likely):** `microservices/core/src/infrastructure/db/tenancy.ts`.
**DoD:** Registry committed; any gap documented (migration deferred to T-002
only if found).
**Tests required:** Unit test asserting every Drizzle table is classified in
exactly one of the two registry lists (no unclassified table).

---

## T-002 — `scopedRepo(orgId)` factory + TenantContext

Status: `[ ]`
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

Status: `[ ]`
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

Status: `[ ]`
**Scope:** Route the existing org-scoped repositories (`userRepo`,
`membershipRepo`, `invitationRepo`, `externalGrantRepo`, `auditRepo` reads)
through `scopedRepo`. Keep `orgRepo`, `webhookDeliveryRepo` tenant-agnostic.
**Files (likely):** `infrastructure/db/*Repo.ts`, callers in `application/*`.
**DoD:** Slice-1 unit + integration suites stay green; no behaviour change.
**Tests required:** Existing suites pass; add a regression that a slice-1 read
is org-scoped.

---

## T-005 — CI tripwire: ban raw access to tenant-scoped tables

Status: `[ ]`
**Scope:** A test mirroring `security/__tests__/nfr-matrix.test.ts` that fails
if any tenant-scoped table name is accessed via raw `db`/Drizzle outside the
factory + its owned repo files.
**Files (likely):** `microservices/core/src/security/__tests__/tenancy-guard.test.ts`.
**DoD:** A deliberately-introduced raw unscoped query fails the test; removing
it passes.
**Tests required:** The tripwire itself (self-testing via a fixture).

---

## T-006 — Property test: no cross-tenant leak

Status: `[ ]`
**Scope:** `fast-check` property test over a real test Postgres: two orgs,
random row distributions, every repo method invoked under one org's scope,
assert zero foreign-org rows. ADR-011 moves to `accepted` on green.
**Files (likely):** `infrastructure/db/__tests__/tenant-isolation.property.test.ts`.
**DoD:** Test wired into CI; shrinking reports the minimal case on failure.
**Tests required:** This is the test.

---

## T-007 — Observability: guard violation metric + alert

Status: `[ ]`
**Scope:** `tenancy.guard.violations` metric + structured log on a
defence-in-depth catch; alarm `> 0 over 5min`.
**Files (likely):** `infrastructure/observability/metrics.ts`, `infra/*`.
**DoD:** Metric emits on a forced violation in a test; alarm wired in infra.
**Tests required:** Unit — metric emitted on guard catch.

---

## T-008 — Slice sign-off + ADR-011 acceptance

Status: `[ ]`
**Scope:** Traceability matrix (FR/NFR/AC → impl → test), flip ADR-011 to
`accepted`, tag. Confirm `room-and-folders` document tasks are now unblocked.
**Files (likely):** `docs/slices/tenant-isolation.md`,
`adr/011-multi-tenant-isolation.md`.
**DoD:** Matrix complete; ADR accepted; sign-off doc merged.
**Tests required:** None (docs); CI green across the slice.
