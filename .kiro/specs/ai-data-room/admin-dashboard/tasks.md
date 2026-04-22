# Tasks — ai-data-room / admin-dashboard

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-04-21

Assumes slices 1–6 and 8 are merged. Runs in the same monorepo.
This slice is largely UI + a small amount of BFF — no domain logic.

## Conventions
Same as prior slices.

---

## T-001 — Component library scaffolding
Status: `[ ]`
**Scope:** Create `packages/web/components/dashboard/` with
primitives: `DataTable`, `Filters`, `InlineActions`, `StatPill`,
`ActivityRow`, `LifecycleBadge`, `VerdictBadge`, `EmptyState`. Each
with Storybook story + Axe test.
**Files (likely):** `packages/web/components/dashboard/*.tsx`,
`packages/web/components/dashboard/*.stories.tsx`.
**DoD:** Storybook build green; axe snapshots captured.
**Tests required:** Storybook + vitest component tests.

---

## T-002 — BFF: `GET /dashboard/home` aggregate
Status: `[ ]`
**Scope:** Compose the five home widgets' data in a single
endpoint. Cache 30s per orgId via LRU.
**Files (likely):**
`microservices/core/application/dashboard/home.ts`,
`microservices/core/handlers/dashboard/home.ts`.
**DoD:** FR1 + FR2 covered; p95 ≤300ms with cache hit.
**Tests required:** Integration.

---

## T-003 — BFF: `GET /capabilities` for the current user
Status: `[ ]`
**Scope:** Returns a map of `{ scope → capabilities }` for the
session user, suitable for the `useCanWrite()` hook. Does not leak
info about unrelated orgs.
**Files (likely):**
`microservices/core/handlers/access/capabilities.ts`.
**DoD:** Response matches the server's `authorize()` decisions.
**Tests required:** Integration — property test invariant
"UI never shows an action the server denies".

---

## T-004 — BFF: audit export CSV endpoint
Status: `[ ]`
**Scope:** Streams audit events per filters; per-row access-control
during streaming; `text/csv` response.
**Files (likely):**
`microservices/core/handlers/audit/export-csv.ts`,
`microservices/core/application/audit/export.ts`.
**DoD:** FR14 + AC-US8 covered.
**Tests required:** Integration — header, row count, ordering,
access enforcement.

---

## T-005 — BFF: `GET /qna/activity` `expand=turnId`
Status: `[ ]`
**Scope:** Extends the existing Q&A activity endpoint (slice 6)
with inline expansion of a turn's citations + passages, gated by
admin's own document access.
**Files (likely):** `microservices/core/handlers/qna/activity.ts`
(modify).
**DoD:** FR13 covered.
**Tests required:** Integration.

---

## T-006 — Layout + auth gate
Status: `[ ]`
**Scope:** `/dashboard/layout.tsx` enforces role
(owner/admin/internal). External users redirected. Internal-user
variant sets `readOnlyMode=true` in a context.
**Files (likely):** `packages/web/app/dashboard/layout.tsx`.
**DoD:** FR17 shell working.
**Tests required:** Playwright.

---

## T-007 — Home page
Status: `[ ]`
**Scope:** Route `/dashboard` consuming `/dashboard/home`; renders
five widgets with skeleton states; poll-on-focus.
**Files (likely):** `packages/web/app/dashboard/page.tsx`,
`packages/web/app/dashboard/_components/HomeWidgets.tsx`.
**DoD:** AC-US1 passes; bundle size within budget.
**Tests required:** Playwright + Lighthouse perf budget.

---

## T-008 — Users page
Status: `[ ]`
**Scope:** Route `/dashboard/users` with DataTable + Filters +
InlineActions (suspend, un-suspend, delete, resend invite, resend
MFA, reset password).
**Files (likely):** `packages/web/app/dashboard/users/**/*.tsx`.
**DoD:** AC-US2, AC-US3 pass.
**Tests required:** Playwright.

---

## T-009 — Invitations page
Status: `[ ]`
**Scope:** Route `/dashboard/invitations` with revoke + re-send
actions.
**Files (likely):**
`packages/web/app/dashboard/invitations/**/*.tsx`.
**DoD:** AC-US4 passes.
**Tests required:** Playwright.

---

## T-010 — Grants page
Status: `[ ]`
**Scope:** Route `/dashboard/grants` grouped by Opportunity,
expiring-soon highlighted, inline extend / revoke / tier-change.
**Files (likely):** `packages/web/app/dashboard/grants/**/*.tsx`.
**DoD:** AC-US5 passes.
**Tests required:** Playwright.

---

## T-011 — Review queue page
Status: `[ ]`
**Scope:** Route `/dashboard/review` consuming sensecheck decisions
queue; inline approve / reject / re-run.
**Files (likely):** `packages/web/app/dashboard/review/**/*.tsx`.
**DoD:** AC-US6 passes.
**Tests required:** Playwright.

---

## T-012 — Q&A activity page
Status: `[ ]`
**Scope:** Route `/dashboard/qna-activity` consuming `/qna/activity`
with expansion on row click.
**Files (likely):**
`packages/web/app/dashboard/qna-activity/**/*.tsx`.
**DoD:** AC-US7 passes.
**Tests required:** Playwright.

---

## T-013 — Audit log page + CSV export
Status: `[ ]`
**Scope:** Route `/dashboard/audit` with filters; "Export CSV"
triggers download of the streamed response.
**Files (likely):** `packages/web/app/dashboard/audit/**/*.tsx`.
**DoD:** AC-US8 passes.
**Tests required:** Playwright.

---

## T-014 — Settings tabs
Status: `[ ]`
**Scope:** Route `/dashboard/settings/*` — four tabs deep-linked:
`org`, `nda`, `checklists`, `sensecheck`, `billing`. Each tab is a
thin wrapper around the source slice's page component where
possible (NFR4).
**Files (likely):** `packages/web/app/dashboard/settings/**/*.tsx`.
**DoD:** AC-US9 passes.
**Tests required:** Playwright.

---

## T-015 — Internal-user read-only mode
Status: `[ ]`
**Scope:** Across all pages, respect `readOnlyMode` context:
hide/disable action affordances; show a top banner.
**Files (likely):** all dashboard pages (small edits each).
**DoD:** FR17 verified in Playwright with an internal-role fixture.
**Tests required:** Playwright.

---

## T-016 — Performance budgets enforcement
Status: `[ ]`
**Scope:** CI check: `next-bundle-analyzer` on dashboard route; fail
if >200KB gzipped. Lighthouse-CI budget on home, users, audit.
**Files (likely):** `.github/workflows/web-budgets.yml`,
`packages/web/lighthouserc.json`.
**DoD:** NFR6 enforced.
**Tests required:** CI pass.

---

## T-017 — Accessibility CI
Status: `[ ]`
**Scope:** Axe-core run on each dashboard Playwright spec; fail on
serious or critical violations.
**Files (likely):** `tests/e2e/dashboard/a11y.spec.ts`.
**DoD:** NFR1 enforced.
**Tests required:** Axe in CI.

---

## T-018 — Observability: client + server metrics
Status: `[ ]`
**Scope:** Emit client-side metrics (fcp, error rates) via
`@axiom-fe`; server-side metrics per design.md.
**Files (likely):**
`packages/web/app/_lib/metrics.ts`,
`microservices/core/infrastructure/metrics/dashboard.ts`.
**DoD:** Metrics observable in CloudWatch / Axiom.
**Tests required:** Smoke.

---

## T-019 — Playwright acceptance suite
Status: `[ ]`
**Scope:** One spec per AC-US1–AC-US9.
**Files (likely):** `tests/e2e/dashboard/*.spec.ts`.
**DoD:** All 9 specs green.

---

## T-020 — Slice sign-off
Status: `[ ]`
**Scope:** Traceability matrix. Tag `v0.7.0-admin-dashboard`.
**Files (likely):** `docs/slices/admin-dashboard.md`.
**DoD:** Matrix merged; tag pushed.

---

## Dependencies

```
T-001 ─► T-007/08/09/10/11/12/13/14/15
T-002 ─► T-007
T-003 ─► T-006 ─► T-007/08/09/10/11/12/13/14/15
T-004 ─► T-013
T-005 ─► T-012

T-016, T-017, T-018 in parallel after T-015
T-019 after T-015
T-020 last
```

## Acceptance for the slice
1. All AC-US* in `requirements.md` pass in Playwright.
2. Bundle + Lighthouse + axe budgets green in CI.
3. `v0.7.0-admin-dashboard` tagged.
