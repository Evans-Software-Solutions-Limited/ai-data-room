# Tasks — ai-data-room / onboarding-flow

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-04-22

Last slice. Assumes all earlier slices merged. Runs in the same
monorepo.

## Conventions

Same as prior slices.

---

## T-001 — PostHog provisioning + privacy review

Status: `[ ]`
**Scope:** Create managed PostHog project; API key stored in
Secrets Manager. Draft `docs/privacy/posthog.md` covering data
sent, retention, geo. Confirm with Bradley.
**Files (likely):** `docs/privacy/posthog.md`,
`infra/secrets.ts` (add key).
**DoD:** Key provisioned; privacy doc reviewed.
**Tests required:** None.

---

## T-002 — Migration: onboarding_progress

Status: `[ ]`
**Scope:** Drizzle migration for `onboarding_progress` table.
**Files (likely):** `packages/db/schema/onboarding.ts`,
`packages/db/migrations/*.sql`.
**DoD:** Applies + rolls back.
**Tests required:** Integration.

---

## T-003 — Domain: types + zod schemas

Status: `[ ]`
**Scope:** `OnboardingFlow` enum, `StepId` union,
`OnboardingProgress`, `AdvanceRequest` schema.
**Files (likely):** `microservices/core/domain/onboarding/*.ts`,
`packages/api-utils/schemas/onboarding.ts`.
**DoD:** Schema tests; barrel exports.
**Tests required:** Vitest.

---

## T-004 — Infrastructure: progress repo

Status: `[ ]`
**Scope:** `OnboardingProgressRepo` — `getForUser`, `upsert`,
`markStepCompleted`, `markStepSkipped`, `dismissGetStarted`,
`completeFlow`.
**Files (likely):**
`microservices/core/infrastructure/db/onboarding/*.ts`.
**DoD:** Integration tested.
**Tests required:** Vitest.

---

## T-005 — Application: progress state machine

Status: `[ ]`
**Scope:** `getProgress(userId)` — returns row + derived step +
auto-completion checks (looks up org description, NDA, Opportunity
presence to mark already-done steps). `advance({userId, to,
action})` — validates reachability.
**Files (likely):**
`microservices/core/application/onboarding/progress.ts`.
**DoD:** FR3, FR5 + AC-US5 covered.
**Tests required:** Vitest unit with fixtures.

---

## T-006 — Application: activation metrics

Status: `[ ]`
**Scope:** Listens to `invitation.created` + `slot.ai_checked`
events; persists activation timestamps; exposes
`/metrics/activation` per-org.
**Files (likely):**
`microservices/core/application/onboarding/activation.ts`,
`microservices/core/handlers/onboarding/activation.ts`.
**DoD:** AC-US7 covered.
**Tests required:** Integration.

---

## T-007 — Handlers: onboarding progress + events

Status: `[ ]`
**Scope:** HTTP routes per design.md §API additions. Role-gated
via `requires(...)`.
**Files (likely):** `microservices/core/handlers/onboarding/*.ts`.
**DoD:** Every route responds per schema.
**Tests required:** Integration.

---

## T-008 — PostHog wrapper (client + server)

Status: `[ ]`
**Scope:** Tiny wrapper exposing `trackEvent(name, props)`. Browser
side initialises on login with the user id; server side a
fetch-based capturer. No PII.
**Files (likely):** `packages/web/app/_lib/posthog.ts`,
`microservices/core/infrastructure/analytics/posthog.ts`.
**DoD:** Events visible in PostHog dashboard.
**Tests required:** Smoke.

---

## T-009 — Web: wizard shell + step routing

Status: `[ ]`
**Scope:** `/onboarding/owner/[step]/page.tsx` — reads progress,
routes to step component, renders progress indicator, Continue /
Skip affordances with live-region announcement.
**Files (likely):**
`packages/web/app/onboarding/owner/[step]/page.tsx`,
`packages/web/app/onboarding/_components/WizardShell.tsx`.
**DoD:** AC-US1, AC-US2 pass.
**Tests required:** Playwright.

---

## T-010 — Web: step 1 welcome + step 2 company basics

Status: `[ ]`
**Scope:** `WelcomeStep` + `CompanyBasicsStep` components. Company
basics writes to `PATCH /orgs/:orgId`.
**Files (likely):**
`packages/web/app/onboarding/owner/_steps/Welcome.tsx`,
`packages/web/app/onboarding/owner/_steps/CompanyBasics.tsx`.
**DoD:** Company basics persists correctly.
**Tests required:** Playwright.

---

## T-011 — Web: step 3 upload first docs

Status: `[ ]`
**Scope:** Reuses `UploadDropzone` from `room-and-folders`;
pre-configured to target `01_Company_Overview` +
`02_Financials` slots.
**Files (likely):**
`packages/web/app/onboarding/owner/_steps/UploadFirstDocs.tsx`.
**DoD:** Uploads land in correct folders/slots.
**Tests required:** Playwright.

---

## T-012 — Web: step 4 NDA template

Status: `[ ]`
**Scope:** Reuses NDA editor from `access-control` slice; defaults
pre-filled from a template library.
**Files (likely):**
`packages/web/app/onboarding/owner/_steps/NdaTemplate.tsx`.
**DoD:** Saving creates NDA template v1.
**Tests required:** Playwright.

---

## T-013 — Web: step 5 first Opportunity + invite

Status: `[ ]`
**Scope:** Combined form: Opportunity name + expiry + tier + first
external invitee + optional message. Two API calls in order
(createOpportunity → createExternalGrant). Partial-failure handling
per NFR4.
**Files (likely):**
`packages/web/app/onboarding/owner/_steps/FirstOpportunity.tsx`.
**DoD:** AC-US3 passes; failure mid-flow preserves inputs.
**Tests required:** Playwright (happy + failure).

---

## T-014 — Web: step 6 done + summary

Status: `[ ]`
**Scope:** Summary of what was set up, per-folder completion,
deep-links to dashboard.
**Files (likely):**
`packages/web/app/onboarding/owner/_steps/Done.tsx`.
**DoD:** Completes flow → `completed_at` set → redirects to
`/dashboard`.
**Tests required:** Playwright.

---

## T-015 — Web: invited-user welcome screens

Status: `[ ]`
**Scope:** `/onboarding/welcome` route rendering one-screen
orientation with content branched by role. External-user variant
includes scope + expiry + extension-request mailto.
**Files (likely):** `packages/web/app/onboarding/welcome/page.tsx`.
**DoD:** AC-US4 passes.
**Tests required:** Playwright.

---

## T-016 — Web: sample room

Status: `[ ]`
**Scope:** Static sample-room data file + `/onboarding/sample-room`
route rendering it. Write affordances locked with explanatory
overlay. "Back to setup" returns to wizard at correct step.
**Files (likely):**
`packages/web/app/onboarding/sample-room/page.tsx`,
`packages/web/app/onboarding/sample-room/_data/sample-room.json`.
**DoD:** AC-US6 passes; no data created in owner's org.
**Tests required:** Playwright.

---

## T-017 — Web: get-started card on dashboard home

Status: `[ ]`
**Scope:** Renders on `/dashboard` (slice 7 home) using onboarding
progress + checklist completion + trial status. Deep-links to
wizard steps. Dismissible.
**Files (likely):**
`packages/web/app/dashboard/_components/GetStartedCard.tsx`
(new, consumed by slice 7 page).
**DoD:** FR8, FR9 covered.
**Tests required:** Playwright.

---

## T-018 — Routing: redirect owners to wizard post-signup

Status: `[ ]`
**Scope:** Post-signup + post-MFA hook checks `onboarding_progress`;
new owner → `/onboarding/owner/welcome`, invited user →
`/onboarding/welcome`. Avoids double redirects on subsequent logins.
**Files (likely):**
`packages/web/app/_lib/post-auth-redirect.ts`,
`microservices/core/application/auth/post-auth.ts` (small edit).
**DoD:** AC-US1 passes; returning owners go to dashboard directly.
**Tests required:** Playwright.

---

## T-019 — Analytics events wiring

Status: `[ ]`
**Scope:** Instrument the wizard + sample room + welcome screens
with the events listed in design.md §Product analytics. Server-side
activation events emitted from T-006.
**Files (likely):** across wizard components + handlers.
**DoD:** Events observable in PostHog within minutes.
**Tests required:** Smoke.

---

## T-020 — NFR + a11y hardening

Status: `[ ]`
**Scope:** Verify NFR1 (<10min completion — manual timed run),
NFR2 (375px responsive — Playwright viewport tests), NFR3 (<1s
p95 — Lighthouse budget), NFR4 (partial-failure preservation —
integration test), NFR6 (WCAG 2.1 AA — axe).
**Files (likely):** `tests/e2e/onboarding/a11y.spec.ts`,
`tests/e2e/onboarding/nfr.spec.ts`.
**DoD:** All NFRs green in CI.
**Tests required:** Playwright + axe.

---

## T-021 — Playwright acceptance suite

Status: `[ ]`
**Scope:** One spec per AC-US1–AC-US7.
**Files (likely):** `tests/e2e/onboarding/*.spec.ts`.
**DoD:** All 7 specs green on e2e.

---

## T-022 — Slice sign-off + MVP release notes

Status: `[ ]`
**Scope:** Traceability matrix; MVP release notes drafted
summarising all 9 slices; run `engineering:deploy-checklist`.
Tag `v1.0.0-mvp`.
**Files (likely):** `docs/slices/onboarding-flow.md`,
`RELEASE_NOTES_v1.0.0.md`.
**DoD:** Matrix + notes merged; tag pushed; MVP shippable.

---

## Dependencies

```
T-001 ─► T-008 ─► T-009 ─► T-010/11/12/13/14
T-002 ─► T-004 ─► T-005 ─► T-007 ─► T-009
T-003 ──────────►│
T-006 (standalone) ──► T-017

T-015, T-016 after T-007
T-017, T-018 after T-014
T-019 in parallel with web tasks
T-020, T-021 after T-019
T-022 last
```

## Acceptance for the slice

1. All AC-US\* in `requirements.md` pass in Playwright.
2. Activation metrics visible in dashboard (T-006).
3. Privacy posture on PostHog signed off (T-001).
4. `v1.0.0-mvp` tagged — MVP complete.
