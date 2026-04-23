# Tasks — ai-data-room / billing-subscription

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-04-22

Assumes `auth-and-orgs` (v0.1) is merged. Can run in parallel with
slices 2–6 once slice 1 is done.

## Conventions

Same as prior slices.

---

## T-001 — Migrations: subscriptions + plan catalogue + overrides + webhook log

Status: `[ ]`
**Scope:** Drizzle migrations for `org_subscriptions`,
`plan_catalogue`, `plan_overrides`, `stripe_webhook_events` per
design.md.
**Files (likely):** `packages/db/schema/billing.ts`,
`packages/db/migrations/*.sql`.
**DoD:** Apply + roll back; introspection clean.
**Tests required:** Integration migration test.

---

## T-002 — Domain: plan module + types

Status: `[ ]`
**Scope:** `microservices/core/domain/billing/plans.ts` exports
typed `PLANS` array. Types for `PlanMetric`, `PlanLimitError`,
`SubscriptionStatus`, `PlanOverride`, `OrgSubscription`. Zod
schemas.
**Files (likely):** `microservices/core/domain/billing/*.ts`,
`packages/api-utils/schemas/billing.ts`.
**DoD:** Schema tests; barrel exports.
**Tests required:** Vitest.

---

## T-003 — Plan catalogue seed

Status: `[ ]`
**Scope:** Deploy-time job that idempotently writes each plan to
`plan_catalogue` from the `PLANS` module; pulls
`stripe_price_id` from a Stripe call (verifying the price exists).
**Files (likely):**
`microservices/core/infrastructure/db/billing/plan-seed.ts`.
**DoD:** Re-deploy is a no-op; missing Stripe price → loud error.
**Tests required:** Integration with Stripe sandbox.

---

## T-004 — Infrastructure: repositories + Stripe client wrapper

Status: `[ ]`
**Scope:** `OrgSubscriptionRepo`, `PlanCatalogueRepo`,
`PlanOverrideRepo`, `WebhookEventRepo`. Stripe wrapper exposes
`createCheckoutSession`, `createBillingPortalSession`,
`getSubscription`, `listSubscriptions`, `verifyWebhook`.
**Files (likely):**
`microservices/core/infrastructure/db/billing/*.ts`,
`microservices/core/infrastructure/stripe/client.ts`.
**DoD:** Each repo method integration tested; Stripe wrapper unit
tested with fixture events.
**Tests required:** Vitest + Stripe sandbox integration.

---

## T-005 — Application: enforcePlanLimit helper

Status: `[ ]`
**Scope:** `enforcePlanLimit(orgId, metric, opts?)` per design.md.
LRU cache keyed by `(orgId, metric)` 30s TTL. Throws
`PlanLimitError`.
**Files (likely):**
`microservices/core/application/billing/enforce.ts`.
**DoD:** NFR3 (≤10ms p95) verified via micro-benchmark.
**Tests required:** Vitest unit + integration.

---

## T-006 — Application: lifecycle + state machine

Status: `[ ]`
**Scope:** `transitionTo(orgId, newStatus, ctx)` — single point
for status changes. Validates legal transitions; emits audit event;
flushes LRU caches; emits in-app notifications via existing
`notifications` channel where applicable.
**Files (likely):**
`microservices/core/application/billing/lifecycle.ts`.
**DoD:** Illegal transitions rejected; happy paths covered.
**Tests required:** Vitest table-driven matrix.

---

## T-007 — Handlers: Stripe webhook

Status: `[ ]`
**Scope:** `POST /webhooks/stripe` — verify signature, idempotency
log, dispatch by event type to lifecycle methods. Returns 200
within 5s.
**Files (likely):** `microservices/core/handlers/billing/webhook.ts`.
**DoD:** NFR2 (signature verify, idempotent) covered.
**Tests required:** Integration with synthetic event fixtures
(payment_succeeded, payment_failed, sub_updated, sub_deleted,
trial_will_end).

---

## T-008 — Handlers: checkout + portal session creators

Status: `[ ]`
**Scope:** `POST /billing/checkout-session` (body `{planId}`),
`POST /billing/portal-session`. Owner-only via `requires(...)`.
Returns `{ url }`.
**Files (likely):** `microservices/core/handlers/billing/checkout.ts`,
`microservices/core/handlers/billing/portal.ts`.
**DoD:** Returns valid Stripe-hosted URLs that complete a
test-mode purchase end-to-end.
**Tests required:** Integration + Playwright round-trip with
Stripe test cards.

---

## T-009 — Handlers: read endpoints

Status: `[ ]`
**Scope:** `GET /billing/subscription`, `GET /billing/usage`,
`GET /billing/plans`. Owner/admin only.
**Files (likely):** `microservices/core/handlers/billing/read.ts`.
**DoD:** Schema-conformant.
**Tests required:** Integration.

---

## T-010 — Read-only middleware: requireWritesEnabled

Status: `[ ]`
**Scope:** Middleware that checks `org_subscriptions.status` ∈
{active, trialing} on mutation routes. Wired into the existing
`requires(...)` middleware as a composable option. Returns 402
with structured body.
**Files (likely):**
`microservices/core/middleware/requires-writes.ts`.
**DoD:** Past_due / canceled / suspended orgs blocked from writes;
reads pass.
**Tests required:** Integration across slices' write endpoints.

---

## T-011 — Apply enforcePlanLimit + requireWritesEnabled across slices

Status: `[ ]`
**Scope:** Modify the four call sites listed in design.md
(invitations, opportunities, sensecheck, qna) to call
`enforcePlanLimit` inline. Add `requireWritesEnabled` to all
mutation handlers.
**Files (likely):** edits across
`microservices/core/application/{auth,room,sensecheck,qna}/*.ts`
and corresponding handlers.
**DoD:** AC-US7 passes; FR12 + FR13 enforced.
**Tests required:** Integration per call site.

---

## T-012 — Reconciliation job

Status: `[ ]`
**Scope:** Daily lambda — recompute true counts vs. cached;
recompute monthly usage; reconcile mirror against Stripe; emit
drift metrics + alerts.
**Files (likely):**
`microservices/core/application/billing/reconcile.ts`,
`microservices/core/handlers/schedule/billing-reconcile.ts`,
`infra/scheduled.ts`.
**DoD:** NFR4 covered.
**Tests required:** Integration with synthetic drift.

---

## T-013 — CLI: billing-admin

Status: `[ ]`
**Scope:** Bun-based CLI per design.md §CLI. Auth: AWS IAM staff
role. Audit-logs every action.
**Files (likely):** `apps/cli/src/billing-admin/*.ts`,
`apps/cli/package.json`.
**DoD:** AC-US8 passes via CLI.
**Tests required:** Unit + a thin integration round-trip.

---

## T-014 — Web: pricing + signup plan picker

Status: `[ ]`
**Scope:** Plan picker component used in onboarding (slice 9) +
upgrade flow. Shows three plans with limits + price + trial CTA.
**Files (likely):**
`packages/web/components/billing/PlanPicker.tsx`,
`packages/web/app/dashboard/settings/billing/page.tsx`.
**DoD:** AC-US1 passes.
**Tests required:** Playwright.

---

## T-015 — Web: billing settings page

Status: `[ ]`
**Scope:** `/dashboard/settings/billing` — current plan, status,
trial countdown, "manage subscription" button → Billing Portal,
"add card" button → Checkout, usage gauges.
**Files (likely):**
`packages/web/app/dashboard/settings/billing/**/*.tsx`.
**DoD:** AC-US2, AC-US4, AC-US5, AC-US6 pass.
**Tests required:** Playwright with Stripe test mode.

---

## T-016 — Web: read-only banners + 402 handling

Status: `[ ]`
**Scope:** Global banner shown when status ∈ {past_due, canceled,
suspended}; toast on 402 responses with upgrade CTA. Specific
"add payment method" CTA in past_due banner.
**Files (likely):**
`packages/web/components/billing/StatusBanner.tsx`,
`packages/web/app/_lib/api-error-handler.ts`.
**DoD:** AC-US3, AC-US7 pass.
**Tests required:** Playwright.

---

## T-017 — Observability: metrics + alerts

Status: `[ ]`
**Scope:** Emit metrics per design.md §Observability. Wire alarms.
**Files (likely):**
`microservices/core/infrastructure/metrics/billing.ts`,
`infra/observability.ts`.
**DoD:** Metrics observable; synthetic alarms fire.
**Tests required:** Smoke.

---

## T-018 — NFR hardening pass

Status: `[ ]`
**Scope:** Verify NFR1 (no PAN/CVC in logs — scrub test),
NFR2 (signature verify + idempotency — integration),
NFR3 (≤10ms p95 — micro-benchmark),
NFR4 (reconcile job correctness),
NFR5 (downgrade-over-cap behaviour),
NFR6 (60s reversal of suspend),
NFR7 (no payment metadata in logs).
**Files (likely):**
`tests/security/billing-nfr-matrix.spec.ts`.
**DoD:** Matrix green in CI.

---

## T-019 — Playwright acceptance suite

Status: `[ ]`
**Scope:** One spec per AC-US1–AC-US8 using Stripe test mode.
**Files (likely):** `tests/e2e/billing/*.spec.ts`.
**DoD:** All 8 specs green on e2e.

---

## T-020 — Slice sign-off

Status: `[ ]`
**Scope:** Confirm final pricing with Bradley; ADR-010 documenting
plan structure + Stripe-as-SoT. Traceability matrix.
Tag `v0.8.0-billing-subscription`.
**Files (likely):** `adr/010-billing-stripe-mirror.md`,
`docs/slices/billing-subscription.md`.
**DoD:** Pricing committed; ADR + matrix merged; tag pushed.

---

## Dependencies

```
T-001 ─► T-003 ─► T-004 ─► T-007 ─► T-010 ─► T-011 ─► T-014/15/16
         ▲        ▲        ▲                  ▲
T-002 ──►│        │        │                  │
                  │        │                  │
                  ├► T-005─┤                  │
                  ├► T-006─┤                  │
                  ├► T-008─┤                  │
                  ├► T-009─┤                  │
                  ├► T-012─┤                  │
                  └► T-013─┘                  │

T-017, T-018 in parallel after T-011
T-019 after T-014–T-016
T-020 last
```

## Acceptance for the slice

1. All AC-US\* in `requirements.md` pass in Playwright (Stripe test
   mode).
2. CLI happy-path verified manually against staging.
3. Pricing confirmed and committed to `plans.ts`.
4. `v0.8.0-billing-subscription` tagged.
