# Requirements — ai-data-room / onboarding-flow

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-04-21
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `auth-and-orgs`, `org-provisioning` (slice 17),
`room-and-folders`, `access-control`, `doc-checklist`

> **Scope change (2026-05-31):** the org-**creation mechanism** (create org →
> first membership → fire `org.created` → canonical room provisions) was pulled
> forward into the new `org-provisioning` slice (17), because slices 2/10 need a
> real `org_id` before this wizard ships. This slice now **wraps** that
> mechanism in guided UX (the "Company basics" step calls `POST /orgs`); it no
> longer owns provisioning.

## Context

The self-serve signup experience that takes a stranger from landing on
the site to having a populated room with external access issued. If the
earlier slices are the engine, this slice is the ignition. It is
deliberately small in net-new functionality — most of what it does is
**sequence** flows the other slices already expose, wrapped in a UX
that makes the product feel like it wants the user to succeed.

This is the **last** slice in the MVP order because it depends on the
other four to exist, and because we want the wizard to reflect what the
product really does, not a preview of what we wish it did.

## Users & roles

- **Primary user:** first-time org owner completing signup for the
  first time.
- **Secondary users:** teammates joining after being invited (a
  scaled-down variant of the wizard for invited users).
- **Roles:** as defined in `auth-and-orgs`.

## User stories

- **US1** — _As a first-time owner, I want a guided "set up your
  room" wizard after signup so I don't stare at an empty interface._
- **US2** — _As a first-time owner, I want to skip any step of the
  wizard and come back to it later without losing state._
- **US3** — _As a first-time owner, I want to create my first
  Opportunity subroom and invite the counterparty directly from the
  wizard — that's the value-moment._
- **US4** — _As an invited teammate, I want a minimal onboarding
  (set password, enrol MFA, get oriented) that isn't the full owner
  wizard._
- **US5** — _As a returning owner, I want the wizard to prompt me
  only for the things I haven't done yet (e.g. "you still need to
  upload an NDA template")._
- **US6** — _As a first-time owner, I want a sample / demo room I
  can peek at so I understand the product without committing to
  populating my own._

## Functional requirements

### Owner wizard

- **FR1** — Immediately after signup + email verification + MFA
  enrolment (from `auth-and-orgs`), new owners shall be directed to
  the wizard at `/onboarding/owner`.
- **FR2** — Wizard steps (MVP):
  1. **Welcome + product tour** — one-screen orientation; 30s read.
  2. **Company basics** — confirm org name, logo upload (optional),
     brief company description (used in `01_Company_Overview`'s
     README-style field if that's kept — see `room-and-folders` open
     question).
  3. **Upload first docs** — present the `01_Company_Overview` and
     `02_Financials` folders with their checklist slots; user can
     upload any subset. Skip-able.
  4. **NDA template** — provide the default NDA text, let the user
     edit company name / counterparty-placeholder / effective-date
     format. Save via `access-control` FR7.
  5. **Create first Opportunity** — name the first subroom (e.g.
     "Acme_Bank_Onboarding"), set expiry (default 30 days), pick
     permission tier, invite first external user by email with
     optional message. Skip-able only if the user explicitly says
     "I'll do this later".
  6. **Done** — summary page showing what was set up, links to
     dashboard home and completion % per folder.
- **FR3** — Wizard state shall be **persisted per owner**. Exit and
  re-entry shall resume at the first incomplete step. Completing the
  wizard marks a flag on the user; returning to the dashboard skips
  the wizard.
- **FR4** — Each step shall have a **skip** action except MFA
  enrolment (already enforced in `auth-and-orgs`). Skipping does not
  discard prior input.
- **FR5** — Progress indicator (e.g. "Step 3 of 6") shall be visible
  throughout.

### Invited-user onboarding

- **FR6** — On first login of an invited `editor` / `viewer` user,
  the system shall show a minimal orientation (one screen) pointing
  them at their role's key affordances. No wizard.
- **FR7** — On first login of an invited `external` user (after
  NDA acceptance), the system shall show a single-screen orientation
  explaining: what they can see, what they can't, expiry date, how
  to request extension.

### Persistent nudges / return prompts

- **FR8** — The dashboard home (from `admin-dashboard`) shall show a
  "get started" card listing incomplete onboarding steps (no NDA
  yet, no Opportunity yet, <50% on `02_Financials`, etc.) until the
  owner dismisses it. The card updates as state changes.
- **FR9** — The dashboard shall surface any **pending trial
  information** (from `billing-subscription`) alongside the
  get-started card — not as a separate nagging banner.

### Sample / demo room

- **FR10** — Owners shall be able to "**Preview a sample room**"
  from the wizard's welcome step. Sample is a read-only,
  pre-populated room showing a filled Starter/SME vendor scenario
  (fake company, fake counterparty). Preview does not require
  leaving the owner's session or creating data in their org.
- **FR11** — The sample room shall exercise the key UX surfaces
  (checklist completion, an AI-sensecheck green light, a Q&A
  example), so the value is visible without the owner uploading
  anything.

### Audit & telemetry

- **FR12** — Every wizard step completion / skip / revisit shall
  emit a product-analytics event tagged with `onboarding_step_id`
  and `user_id`. This is in addition to (not a replacement for)
  security audit events.
- **FR13** — The system shall track **activation** as a dashboard
  metric: time from signup to first external invite sent; time from
  signup to first AI sense-check green; % of owners who complete
  every wizard step.

## Non-functional requirements

- **NFR1** — The wizard shall be completable in under **10 minutes**
  for a prepared user (docs in hand, Opportunity counterparty known).
- **NFR2** — The wizard shall be mobile-functional on 375px+
  viewports (can be degraded — e.g. logo upload disabled on mobile).
- **NFR3** — Wizard pages shall load ≤1s p95.
- **NFR4** — The wizard shall handle partial failures gracefully —
  if e.g. the invite in Step 5 fails, the user stays on Step 5 with
  a clear error and their prior inputs preserved; the wizard does
  not half-commit.
- **NFR5** — Product-analytics events shall be sent to a single
  event collector (TBD in design — likely self-hosted PostHog or
  Segment, not a privacy hazard provider) and be easily exportable.
- **NFR6** — Accessibility: WCAG 2.1 AA; keyboard-navigable; screen
  reader labels on every interactive element.

## Acceptance criteria

- **AC-US1** — A new owner completes signup + MFA + email
  verification and is taken into `/onboarding/owner` at step 1.
- **AC-US2** — The owner skips step 3, closes the browser, logs back
  in — they're returned to the dashboard with a "finish setup" card
  deep-linking to step 3.
- **AC-US3** — The owner names their first Opportunity and invites
  an external viewer; the invite lands (per `auth-and-orgs` +
  `access-control`), the NDA template is in place, the wizard's
  "Done" summary reflects the work.
- **AC-US4** — An invited admin logs in for the first time and sees
  the invited-user orientation screen, not the owner wizard.
- **AC-US5** — A returning owner who already has an Opportunity
  doesn't re-see Step 5 — either the wizard auto-skips it or marks
  it done; either way, no duplicate Opportunity is created.
- **AC-US6** — The sample room preview loads without creating any
  data in the owner's org; exiting it returns to the wizard at the
  exact step the owner was on.
- **AC-US7** — Time-to-first-external-invite is trackable per org
  in the admin dashboard; the metric reflects real invites only
  (not sample-room previews).

## Non-goals (for this slice)

- Interactive product tour with tooltips over real UI — Phase 2
  (Intercom / native tour library).
- Role-specific wizards for `viewer` users — minimal orientation
  only at v0.1.
- In-app support chat — Phase 2.
- Help centre / documentation hub — Phase 2.
- Email onboarding sequence — Phase 2 product-email slice.
- Self-serve data import from a legacy data-room product — Phase 2.
- NPS / CSAT prompts — Phase 2.
- A/B testing of wizard variants — Phase 2.

## Open questions

- Do we require the owner to complete **every** step before they
  can dismiss the wizard, or is skipping everything fine? Leaning
  **skipping fine** — forced wizards feel patronising. Nudge
  persistently in the dashboard instead.
- Sample room data — should it be a fake company, or should we
  partner with a friendly customer for a real-looking sample?
  Leaning **fake with Capital Pay's permission for visual
  verisimilitude** (no real data).
- Product analytics provider — PostHog self-hosted vs. managed vs.
  Segment. Leaning **PostHog managed at v0.1** — fastest to
  integrate; revisit privacy posture when non-UK customers appear.
- Should invited external users see a **walkthrough** of the data
  room UX, given they're new to the product too? Leaning **single
  page orientation only** (FR7) — external users' goal is
  completing their task, not learning the product.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
