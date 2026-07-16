# Tasks — ai-data-room / access-control

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-04-21

Assumes `auth-and-orgs` (v0.1) and `room-and-folders` (v0.2) are
merged. Runs in the same monorepo.

## Conventions

Same as prior slices.

---

## T-001 — Migrations: extend grants + new tables

Status: `[ ]`
**Scope:** Migration to: add columns to `external_access_grants`
(`permission_tier`, `expires_at`, `status` enum extension,
`nda_template_id`, `nda_acceptance_id`, `revoked_at`, `revoked_by`).
Create `nda_templates`, `nda_acceptances`, `internal_exclusions`
tables. Replace `opportunity_slug` column with `opportunity_id` FK
→ `opportunities.id` (backfill from `(org_id, opportunity_slug)`),
per design §"`opportunity_slug` → `opportunity_id` FK" and
[ADR-014](../../../adr/014-archive-triggered-grant-revocation.md).
Dropping the slug column breaks `room-and-folders`'s
`ExternalGrantRepo`, so this task also: re-keys
`revokeActiveForOpportunity` on `opportunity_id`, updates
`archiveOpportunity` to pass the id, and **deletes the
`retargetOpportunitySlug` rename stopgap** (no longer needed once grants
key on the immutable id).
**Files (likely):** `packages/db/schema/access.ts`,
`packages/db/migrations/*.sql`,
`microservices/core/src/infrastructure/db/externalGrantRepo.ts`,
`microservices/core/src/application/room/opportunities.ts`.
**DoD:** Migrations apply + roll back in test; slug→id data migration
verified against seeded data; room-and-folders' rename/archive tests
pass without the re-key hack; the `retargetOpportunitySlug` unit +
integration coverage is removed with the method.
**Tests required:** Integration migration test.

---

## T-002 — Domain: types + zod schemas

Status: `[ ]`
**Scope:** `PermissionTier`, `GrantStatus` (extended enum),
`ResourceTarget` discriminated union, `Capability`, `NdaTemplate`,
`NdaAcceptance`, `InternalExclusion`, `AuthorizationResult`.
**Files (likely):** `microservices/core/domain/access/*.ts`,
`packages/api-utils/schemas/access.ts`.
**DoD:** Barrel exports; schema tests.
**Tests required:** Vitest.

---

## T-003 — Infrastructure: repositories

Status: `[ ]`
**Scope:** `GrantRepo` (extends auth-and-orgs', adds new methods:
`listExpiringBefore`, `transitionStatus`, `editTier`, `editExpiry`),
`NdaTemplateRepo`, `NdaAcceptanceRepo`, `InternalExclusionRepo`.
**Files (likely):**
`microservices/core/infrastructure/db/access/*.ts`.
**DoD:** Each method has an integration test.
**Tests required:** Vitest integration.

---

## T-004 — Application: authorisation engine

Status: `[ ]`
**Scope:** `authorize(session, target, capability)` returns an
`AuthorizationResult`. Implements the matrix in design.md with
exhaustive branch coverage. Pure function of its inputs — no IO.
**Files (likely):**
`microservices/core/application/access/authorize.ts`.
**DoD:** 100% branch coverage via property tests; table-driven
parametric tests cover every (role, tier, target.kind, capability)
tuple.
**Tests required:** Vitest + fast-check property tests.

---

## T-005 — Middleware: hydrate session grants + exclusions

Status: `[ ]`
**Scope:** Middleware that, after the session middleware from
auth-and-orgs, hydrates `session.opportunityGrants` and
`session.internalExclusions` from the repos. Same LRU cache (60s TTL)
pattern; cache is keyed by `userId` for this data.
**Files (likely):**
`microservices/core/middleware/hydrate-access.ts`.
**DoD:** Middleware runs in <20ms p95 for cached hits.
**Tests required:** Integration with cache hit + miss.

---

## T-006 — Middleware: authorisation wrapper + handler decorator

Status: `[ ]`
**Scope:** Provide a `requires(target, capability)` decorator /
wrapper for handlers. Wrapper extracts target from `params`,
computes capability, calls `authorize`, returns 403/404 per
design.md's denial rules. Handlers without the decorator **fail
closed** — middleware rejects them to prevent accidental
unauthenticated endpoints.
**Files (likely):**
`microservices/core/middleware/requires-capability.ts`.
**DoD:** A handler without the decorator returns 500 "missing auth
contract" in dev; tests fail fast.
**Tests required:** Integration — each handler registered with a
decorator; a fixture handler without one fails.

---

## T-007 — Application: grant lifecycle

Status: `[ ]`
**Scope:** `createExternalGrant` (integrates with auth-and-orgs
invitation flow) — **stamps `opportunity_id`** (not slug) on the grant,
resolved from the invitation; to be rename-proof the id must be fixed at
invite time, so this depends on the invitation carrying `opportunity_id`
(a small `auth-and-orgs` follow-on — see design §"`opportunity_slug` →
`opportunity_id` FK"; if that follow-on isn't done, resolve the current
Opportunity at creation and document the residual). `revokeGrant`,
`editGrantExpiry`, `editGrantTier`, `listGrants` with FR16 filters — all
key on `opportunity_id`. Each writes audit events.
**Files (likely):**
`microservices/core/application/access/grants.ts`.
**DoD:** FR1–FR4, FR6 covered; grants carry + are revoked by
`opportunity_id`; the ADR-014 invite-accept-after-rename edge is closed
(or its residual explicitly documented if the invitation follow-on is
deferred).
**Tests required:** Unit for each branch, incl. a rename-then-accept case.

---

## T-008 — Application: NDA template CRUD + immutability

Status: `[ ]`
**Scope:** `getCurrentNdaTemplate`, `replaceNdaTemplate`. On replace:
mark previous `is_current=false`, insert new with `version = max+1`.
Uniqueness constraint enforced.
**Files (likely):**
`microservices/core/application/access/nda-template.ts`.
**DoD:** FR7 covered; existing accepted grants remain bound to their
original template version.
**Tests required:** Integration.

---

## T-009 — Application: NDA acceptance

Status: `[ ]`
**Scope:** `acceptNda(grantId, renderedBody, fields)` — server
re-renders, compares hashes, writes `nda_acceptances`, flips
`grant.status='active'`, binds `grant.nda_acceptance_id`. Reject if
already accepted, if grant not `pending_nda`, or if hash mismatches.
**Files (likely):**
`microservices/core/application/access/nda-acceptance.ts`.
**DoD:** FR5, FR15 covered.
**Tests required:** Unit + integration.

---

## T-010 — Application: internal exclusions

Status: `[ ]`
**Scope:** `addExclusion`, `removeExclusion`, `listExclusions`.
Enforce FR10 (exclusions don't notify the user).
**Files (likely):**
`microservices/core/application/access/exclusions.ts`.
**DoD:** Exclusion applied → internal user's next request (after
cache bust) cannot list or download from that Opportunity.
**Tests required:** Integration.

---

## T-011 — Scheduled job: expiry sweep

Status: `[ ]`
**Scope:** EventBridge cron every 10 minutes invokes a lambda that
transitions `active` → `expired` for past `expires_at` grants and
audit-logs each transition. Idempotent.
**Files (likely):**
`microservices/core/application/access/expiry-sweep.ts`,
`microservices/core/handlers/schedule/grant-expiry.ts`,
`infra/scheduled.ts`.
**DoD:** FR8, NFR3 covered.
**Tests required:** Integration with frozen clock.

---

## T-012 — Download revalidator lambda

Status: `[ ]`
**Scope:** Minimal lambda (own SST function). Parses signed token,
looks up grant, checks exclusions, verifies `expires_at` in future,
302-redirects to the S3 pre-signed URL. Rejects with 403 otherwise.
Rate-limited; logs every deny.
**Files (likely):** `microservices/core/handlers/download/revalidator.ts`,
`infra/download-revalidator.ts`.
**DoD:** FR12 covered (revocation within 60s); p95 added latency ≤30ms.
**Tests required:** Integration — seeded grants, hit the endpoint
with valid + revoked + expired tokens.

---

## T-013 — Integrate revalidator into room-and-folders download

Status: `[ ]`
**Scope:** Update `microservices/core/application/room/download.ts`
to issue signed claim tokens alongside the S3 pre-signed URL, point
them at the revalidator's endpoint. The handler no longer returns
the raw S3 URL — it returns the revalidator URL.
**Files (likely):** `microservices/core/application/room/download.ts`
(modify), `microservices/core/infrastructure/download/claim.ts` (new).
**DoD:** AC-US4 works end-to-end (revocation kills outstanding URLs
within 60s).
**Tests required:** Integration + Playwright.

---

## T-014 — Handlers: grants, exclusions, NDA

Status: `[ ]`
**Scope:** Wire application into HTTP per design.md. All routes
behind `requires(target, capability)` decorator. 404 vs. 403 branch
applied per role.
**Files (likely):** `microservices/core/handlers/grants/*.ts`,
`microservices/core/handlers/exclusions/*.ts`,
`microservices/core/handlers/nda/*.ts`.
**DoD:** All endpoints respond per schema.
**Tests required:** Integration.

---

## T-015 — Apply middleware to room-and-folders handlers

Status: `[ ]`
**Scope:** Add `requires(...)` to every handler in
`microservices/core/handlers/rooms`, `opportunities`, `documents`,
`uploads`. No route exits v0.3 without explicit authorisation.
**Files (likely):** all `handlers/rooms/*`, `handlers/opportunities/*`,
`handlers/documents/*`, `handlers/uploads/*`.
**DoD:** Every handler decorated; lint rule added to catch un-decorated
handlers.
**Tests required:** A "no-undecorated-handler" static check + integration
tests verifying denial behaviour per role.

---

## T-016 — Web: grant creation + management UI

Status: `[ ]`
**Scope:** Pages for admin: create external grant (invite flow, opens
from `Opportunities/:id` view), list grants, edit (tier + expiry),
revoke. Includes expiring-soon highlight.
**Files (likely):**
`packages/web/app/room/opportunities/[id]/grants/**/*.tsx`.
**DoD:** AC-US1, AC-US4, AC-US5 pass.
**Tests required:** Playwright.

---

## T-017 — Web: external-user NDA + scoped view

Status: `[ ]`
**Scope:** External-user-only pages: NDA acceptance screen; scoped
document list (only the granted Opportunity); preview-only UX for
`viewer` tier (download button hidden/disabled).
**Files (likely):** `packages/web/app/external/**/*.tsx`.
**DoD:** AC-US2, AC-US3, AC-US7 pass.
**Tests required:** Playwright.

---

## T-018 — Web: NDA template editing (admin)

Status: `[ ]`
**Scope:** Settings → NDA template editor. Markdown-aware. Shows
version history. Save → new version.
**Files (likely):** `packages/web/app/settings/nda/**/*.tsx`.
**DoD:** Editing an NDA creates a new version; accepted grants stay
bound to old.
**Tests required:** Playwright.

---

## T-019 — Observability: metrics + alerts

Status: `[ ]`
**Scope:** Emit the metrics named in design.md §Observability; wire
alarms.
**Files (likely):** `microservices/core/infrastructure/metrics/access.ts`,
`infra/observability.ts`.
**DoD:** Metrics emitted; synthetic probe fires the expected alarm.
**Tests required:** Smoke.

---

## T-020 — NFR hardening pass

Status: `[ ]`
**Scope:** Verify NFR1 (≤20ms p95 enforcement), NFR2 (no resource
existence leak — automated corpus test), NFR3 (idempotent expiry),
NFR4 (forward-compat for folder-level scoping — schema check),
NFR5 (NDA template immutability — trigger test), NFR6 (60s
revocation — timing test), NFR7 (audit log 90-day query latency).
**Files (likely):** `tests/security/access-nfr-matrix.spec.ts`,
`docs/security.md`.
**DoD:** Matrix green in CI.

---

## T-021 — Playwright acceptance suite

Status: `[ ]`
**Scope:** One spec per AC-US1–AC-US9.
**Files (likely):** `tests/e2e/access-control/*.spec.ts`.
**DoD:** All 9 specs green on e2e.

---

## T-022 — Slice sign-off + ADRs

Status: `[ ]`
**Scope:** Draft ADR-004 (grant table extension) + ADR-005 (authz
middleware) linked from design.md. Traceability matrix. Tag
`v0.3.0-access-control`.
**Files (likely):** `adr/004-access-grant-table-extension.md`,
`adr/005-authorization-middleware.md`,
`docs/slices/access-control.md`.
**DoD:** ADRs + matrix merged; tag pushed.

---

## Dependencies

```
T-001 ──► T-003 ──► T-007 ──► T-014 ──► T-015
         ▲          ▲          ▲
T-002 ──►│          │          │
         │          │          │
        T-004 ───► T-005 ───► T-006
                   │          │
                   ├► T-008 ──┤
                   ├► T-009 ──┤
                   ├► T-010 ──┤
                   └► T-011 ──┘
         T-012 (standalone) ─► T-013

T-016, T-017, T-018 after T-014
T-019, T-020 in parallel with web tasks
T-021 after T-015 + web tasks
T-022 last
```

Parallelisable after T-006:

- T-007 / T-008 / T-009 / T-010 / T-011 / T-012 — independent.
- Web tasks (T-016 / T-017 / T-018) after T-014.

## Acceptance for the slice

1. All AC-US\* in `requirements.md` pass in Playwright.
2. T-022 traceability + ADRs merged.
3. `v0.3.0-access-control` tagged.
