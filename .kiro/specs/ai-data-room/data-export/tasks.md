# Tasks — ai-data-room / data-export

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-31

Assumes `auth-and-orgs` (GDPR delete), `room-and-folders`, `tenant-isolation`
merged; `billing-subscription` provides the cancellation event (offboarding
tasks can stub it until billing lands). Executes in `microservices/core`,
`microservices/workers`, `packages/db`, `packages/web`. 90% coverage gate.

---

## T-001 — Migrations + domain: export_jobs + org_lifecycle

Status: `[ ]`
**Scope:** Two tenant-scoped tables + domain types (scope enum, lifecycle
states); versioned manifest schema definition.
**Files (likely):** `packages/db/schema/export.ts`, migrations,
`microservices/core/domain/export/*`.
**DoD:** Migrations apply; scoped; manifest schema versioned + unit-covered.
**Tests required:** Integration (apply + scoped); manifest schema unit tests.

---

## T-002 — Export worker: bundle assembly

Status: `[ ]`
**Scope:** Worker streams document bytes into a zip in canonical-folder layout +
per-entity manifest files + root index; uploads to tenant-scoped 7-day-TTL
prefix; marks ready; emits audit + `notifications` event.
**Files (likely):** `microservices/workers/src/export/exportWorker.ts`,
`infrastructure/s3/exports.ts`, `infra/export.ts`.
**DoD:** Full-org + scoped exports produce correct bundles; TTL set.
**Tests required:** Integration — bundle layout + manifest contents for org +
opportunity scope.

---

## T-003 — Application: export request + download API

Status: `[ ]`
**Scope:** `POST /exports` (owner-gated, scope options), `GET /exports`,
`GET /exports/:id/download` (signed URL when ready).
**Files (likely):** `application/export/*`.
**DoD:** Owner-gated; external users denied; download only when ready; audit
emitted.
**Tests required:** Unit — auth matrix, scope options, ready-state gating.

---

## T-004 — Offboarding state machine + read-only enforcement

Status: `[ ]`
**Scope:** React to `subscription.cancelled` → offboarding, org read-only, final
export queued, grace timer; reactivation path.
**Files (likely):** `application/export/offboarding.ts`, access-layer read-only
guard, `infra/*`.
**DoD:** Cancellation → read-only + final export + grace; reactivation restores
active.
**Tests required:** Unit — state transitions; read-only enforced; reactivation.

---

## T-005 — Purge worker + residual-row verification

Status: `[ ]`
**Scope:** At `grace_until`, run `auth-and-orgs` hard-delete across the
tenant-scoped table registry; verify zero residual rows; mark `purged`; audit.
**Files (likely):** `microservices/workers/src/export/purgeWorker.ts`.
**DoD:** Purge removes all org data; verification asserts zero residual rows
across the registry.
**Tests required:** Integration — seed org, purge, assert zero residual rows in
every tenant-scoped table (ties to `tenant-isolation` registry).

---

## T-006 — Web: exports + lifecycle UI

Status: `[ ]`
**Scope:** Owner screen to request/download exports + view lifecycle state +
reactivate during grace.
**Files (likely):** `packages/web/src/pages/DataExport.tsx`, components.
**DoD:** Request → notified → download flow; lifecycle + reactivate visible.
**Tests required:** Component tests (request, status, reactivate).

---

## T-007 — Observability + NFR hardening

Status: `[ ]`
**Scope:** Export/offboarding/purge metrics; `residual_rows>0` alarm; bundle TTL
+ tenant-scope hardening pass.
**Files (likely):** `infrastructure/observability/metrics.ts`, `infra/*`.
**DoD:** Metrics emit; residual-rows alarm wired; NFR matrix complete.
**Tests required:** Unit — metric emission; verification assertion.

---

## T-008 — Playwright acceptance + slice sign-off

Status: `[ ]`
**Scope:** E2E: owner requests export → downloads bundle; cancellation →
read-only + final export → (simulated) purge verified. Traceability matrix;
sign-off; tag.
**Files (likely):** `e2e/specs/data-export/*`, `docs/slices/data-export.md`.
**DoD:** E2E green; matrix complete; sign-off merged.
**Tests required:** Playwright suite; CI green.
