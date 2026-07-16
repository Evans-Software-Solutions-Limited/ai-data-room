# Requirements — ai-data-room / billing-subscription

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-07-16
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `auth-and-orgs`

## Context

Capital Pay is our first paying customer at standard pricing — no
equity, no free tier. This slice delivers **self-serve billing** via
Stripe so a new org can sign up, put a card on file, pay monthly, and
see invoices without Bradley talking to them. It also enforces the
plan's limits (user count, Opportunity count, AI-sensecheck quota,
Q&A quota) at runtime so we don't quietly run up our Anthropic bill on
behalf of a freeloading account.

This slice intentionally does **not** block the MVP demo to Capital Pay:
v0.1 plans can be set manually via an admin back-door if Stripe
integration lands late.

## Users & roles

- **Primary user:** org owner signing up and managing billing.
- **Secondary users:** internal Bradley (support operator) — can see
  an org's plan state via the admin back-door.
- **Roles:** only `owner` can change billing state; `editor` can view;
  `viewer` and `external` never see billing.

## User stories

- **US1** — _As a new org owner, I want to see the available plans on
  signup and pick one so I'm not stuck in a "book a call" flow._
- **US2** — _As an owner, I want to enter a card and pay immediately
  so I can start using the product._
- **US3** — _As an owner, I want a clearly-labeled 14-day free trial
  so I can evaluate the product before being charged._
- **US4** — _As an owner, I want to upgrade or downgrade plans
  mid-cycle with prorated billing._
- **US5** — _As an owner, I want to cancel the subscription and
  retain read-only access until the period ends._
- **US6** — _As an owner, I want to see and download past invoices
  from the app._
- **US7** — _As an owner, I want clear in-app warnings when I'm
  approaching my plan's user / Opportunity / AI-quota limits._
- **US8** — _As Bradley (operator), I want to override a plan for a
  specific org (e.g., Capital Pay pilot) without them hitting a
  self-serve flow._

## Functional requirements

### Plan catalogue (v0.1)

- **FR1** — **Two published plans at v0.1** per
  [ADR-013](../../../../adr/013-launch-pricing-model.md) (accepted
  2026-07-16). Price points and the per-org axis are fixed by the ADR;
  quota numbers below are indicative — finalise in design phase within
  ADR-013's principles (external invitees never billable; AI quota
  in-plan, hard block at cap):

| Plan         | Users (internal) | Active external grants | Opportunities | AI sense-checks / mo | Q&A questions / mo | Price / month |
| ------------ | ---------------- | ---------------------- | ------------- | -------------------- | ------------------ | ------------- |
| **Starter**  | 3                | unlimited (fair use)   | 3             | 100                  | 500                | £99           |
| **Business** | 10               | unlimited              | unlimited     | 500                  | 2,000              | £279          |

Annual billing at ~15–20% discount alongside monthly. The former
third self-serve tier ("Scale") is dropped at launch — revisit via a
superseding ADR if self-serve demand outgrows Business. The anchor
customer runs on the enterprise/custom row (FR2) as a negotiated
annual contract (£3–8k/yr band), never a published tier.

- **FR2** — An **enterprise/custom** plan exists as a row in the
  backing table but is not self-serve; Bradley sets limits via the
  back-door (FR14).
- **FR3** — Plan state per org shall be: `plan_id`, `billing_period`
  (monthly at v0.1), `trial_ends_at`, `current_period_start`,
  `current_period_end`, `status` (`trialing` / `active` /
  `past_due` / `canceled` / `suspended`).

### Signup + trial

- **FR4** — Signup via `auth-and-orgs` shall create the org in the
  **Starter** plan on a **14-day free trial** by default. No card
  required to start.
- **FR5** — During trial, all product features function normally
  within the Starter plan's limits.
- **FR6** — **3 days before** and **on the day** the trial ends, the
  system shall in-app notify the owner (email notifications are out
  of scope for this slice; they live in the later product-email
  slice).
- **FR7** — At trial end, if no card is on file, the org transitions
  to `status=past_due` and:
  - The product switches to **read-only** mode for internal users
    (lists and downloads work; uploads and invites are blocked).
  - Existing external grants remain valid until expiry; new grants
    cannot be issued.
  - Q&A and sense-check calls are blocked.
  - Owner sees a persistent "add payment method" banner.

### Card, payment, upgrade, downgrade

- **FR8** — Owners shall be able to add a payment method via **Stripe
  Checkout** (hosted) at any time. On success, the card is saved to
  a Stripe Customer keyed to the `organizations.id`.
- **FR9** — Owners shall be able to upgrade or downgrade plans via
  Stripe Billing Portal (hosted). Proration handled by Stripe.
- **FR10** — Owners shall be able to cancel the subscription via the
  Billing Portal. Cancellation takes effect at period end; during
  the grace window, the org continues on the old plan.

### Invoices & billing history

- **FR11** — The Billing Portal is the source of truth for invoice
  history, PDF download, and payment method management. We embed a
  deep link in the admin dashboard; we do not duplicate Stripe's UI.

### Limit enforcement

- **FR12** — The system shall enforce plan limits at **write time**:
  - Internal user count — block invite if plan user count is at
    the cap.
  - Opportunity count — block create if at cap.
  - Active external grants — block invite if at cap.
  - AI sense-check monthly quota — block further auto-triggered
    sense-checks once hit; existing in-flight complete.
  - Q&A monthly quota — block further questions once hit.
- **FR13** — Enforcement responses shall be 402 Payment Required with
  `{ reason: 'plan_limit_reached', metric: <...>, current: N, limit: M,
upgrade_url: '/settings/billing' }`.

### Admin back-door

- **FR14** — Bradley-only back-door endpoints (behind a
  staff-only auth check, enforced outside this slice — TBD mechanism)
  shall allow: set plan, grant a temporary override on any limit with
  an expiry date, view an org's current usage. Capital Pay pilot uses
  this path until Stripe integration is fully tested.

### Audit & observability

- **FR15** — Every billing-relevant event shall audit-log: plan
  change, trial ended, card added, card updated, subscription
  canceled, invoice paid, invoice failed, limit override applied,
  limit hit (FR13), suspension for non-payment.
- **FR16** — Metrics shall be emitted per org per day: usage counters
  (users, Opportunities, AI checks, Q&A) and days-remaining on trial
  / subscription.

## Non-functional requirements

- **NFR1** — Card PAN / CVC never touches our servers — all
  PCI-sensitive flows stay in Stripe's iframes / hosted pages.
- **NFR2** — Stripe webhook handler shall verify signatures and be
  idempotent; duplicate webhook delivery is a no-op.
- **NFR3** — Plan-limit checks shall add ≤10ms p95 to the
  gated request.
- **NFR4** — Usage counters shall be accurate to within 5 minutes of
  reality, reconciled daily by a scheduled job against primary data.
- **NFR5** — Downgrade at period boundary shall not silently lose
  data — if a downgrade would violate a cap (e.g. 15 users → plan
  with cap of 10), the system shall **allow the downgrade** but
  block further invites/uploads for the over-cap resource and show a
  clear reconciliation UI to the owner. No auto-deletion.
- **NFR6** — Suspensions from `past_due` shall be **reversible** —
  adding a card and paying the outstanding invoice restores full
  access within 60 seconds.
- **NFR7** — Billing endpoints shall be logged with `orgId` and
  `stripeCustomerId` only; no raw payment metadata.

## Acceptance criteria

- **AC-US1** — During signup, the owner sees the three plans side by
  side with the per-plan limits and price; the default selection is
  Starter + "start 14-day free trial".
- **AC-US2** — An owner in the trial adds a card via Stripe Checkout;
  returns to the app showing `status=trialing` with card on file;
  at trial end auto-transitions to `active`.
- **AC-US3** — An owner whose trial ends without a card sees the
  product in read-only mode with a banner directing them to the
  billing flow; adding a card and paying restores write access
  within 60s.
- **AC-US4** — An owner upgrades Starter → Growth via the Billing
  Portal; proration is reflected on the next invoice; all Growth
  limits apply immediately.
- **AC-US5** — An owner cancels; the subscription stays `active`
  until period end, then transitions to `canceled` with read-only
  access through the grace window.
- **AC-US6** — Invoices are viewable in the Billing Portal link;
  PDF download works.
- **AC-US7** — An owner at cap (e.g. 3 users on Starter) attempting
  to invite a 4th receives a clear 402 + upgrade CTA. Upgrading
  immediately unblocks the invite.
- **AC-US8** — Bradley applies a back-door override on Capital Pay's
  org (e.g. Scale plan + 5x normal Q&A quota for diligence); the
  override is audit-logged and Capital Pay's dashboard reflects the
  elevated limits.

## Non-goals (for this slice)

- Usage-based / metered billing — v0.1 is flat-rate only.
- Annual billing — monthly only at v0.1.
- Multiple currencies — GBP only at v0.1 (confirm with Bradley).
- Invoicing customers with NET-30 terms — Phase 2.
- Coupons / discount codes — Phase 2.
- Referral / affiliate programme — Phase 2.
- Dunning email cadence — lives in product-email slice (Phase 2
  candidate).
- Granular per-feature paywalls (e.g. "Growth adds SSO") — Phase 2
  when SSO slice lands.
- Tax (VAT) automation beyond what Stripe Tax handles — confirm
  Stripe Tax enablement in design.

## Open questions

- ~~Final pricing~~ — **Resolved 2026-07-16 per
  [ADR-013](../../../../adr/013-launch-pricing-model.md):** £99 / £279
  two-tier published pricing, per-org axis, AI quota in-plan; only the
  per-tier quota numbers remain for design phase.
- Stripe Tax on or off at v0.1? Leaning **on** — avoids a Phase 2
  scramble when first non-UK customer lands.
- Plan enforcement for **AI sense-check quota** — hard block vs.
  soft overage with stated per-call cost. Leaning **hard block at
  v0.1** — simpler, predictable bill, upgradeable later.
- Read-only vs. soft-lock at trial end — I picked **read-only** in
  FR7 as the most customer-friendly option (preserves existing
  external commitments). Confirm.
- Should we ship the admin back-door (FR14) as a CLI or a hidden
  admin page? Leaning **CLI** — reduces attack surface and matches
  Bradley's ops preference.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
