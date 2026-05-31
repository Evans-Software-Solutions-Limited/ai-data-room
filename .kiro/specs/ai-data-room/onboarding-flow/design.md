# Design — ai-data-room / onboarding-flow

**Status:** draft
**Requirements:** [./requirements.md](./requirements.md)
**Last updated:** 2026-04-22
**Depends on:** `auth-and-orgs`, `room-and-folders`, `access-control`,
`doc-checklist`, `billing-subscription`

## Summary

Owner wizard is a six-step state-machine UI under `/onboarding/owner`.
Wizard state is persisted in a single `onboarding_progress` row
per user; every step is fully resumable. Each step is a thin form
that calls existing slice APIs — no new domain capability beyond
the progress table and a tiny "get-started checklist" derivation.
Invited users get a separate single-screen orientation
(`/onboarding/welcome`). Sample/demo room is a hard-coded read-only
view served by the web package — no data created in the owner's
org. Activation events flow into PostHog (managed) for product
analytics.

## Architecture

```mermaid
flowchart LR
  Owner[Owner browser]
  External[External browser]

  subgraph Web["Vite SPA web"]
    Wizard[/onboarding/owner/[step]]
    Welcome[/onboarding/welcome]
    Sample[/onboarding/sample-room]
    Dashboard[/dashboard with get-started card]
  end

  subgraph Core["microservices/core"]
    ProgressAPI[/onboarding/progress]
    Slices[Existing slice APIs]
  end

  PostHog[PostHog managed]

  Owner --> Wizard
  Wizard --> ProgressAPI
  Wizard --> Slices
  Owner --> Sample
  External --> Welcome
  Owner --> Dashboard
  Wizard --> PostHog
  Welcome --> PostHog
```

## Data model

### `onboarding_progress`

One row per user. Drives resumability + dashboard nudges.

| Column                  | Type                                                                 | Notes                                             |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| `user_id`               | `uuid` PK FK `users.id`                                              |                                                   |
| `org_id`                | `uuid` FK                                                            | Denormalised for quick admin queries.             |
| `flow`                  | `enum('owner','invited_editor','invited_viewer','invited_external')` |                                                   |
| `current_step`          | `text`                                                               | e.g. `welcome`, `company_basics`, `done`.         |
| `completed_steps`       | `text[]` default `'{}'`                                              | Idempotent marker per step.                       |
| `skipped_steps`         | `text[]` default `'{}'`                                              |                                                   |
| `started_at`            | `timestamptz`                                                        |                                                   |
| `completed_at`          | `timestamptz` nullable                                               | Set when wizard finished or explicitly dismissed. |
| `dismissed_get_started` | `boolean` default false                                              | FR8 dismiss state.                                |
| `updated_at`            | `timestamptz`                                                        |                                                   |

Index: `(org_id)` for admin metrics queries.

## Owner wizard state machine

Steps (FR2):

```
welcome → company_basics → upload_first_docs → nda_template → first_opportunity → done
```

Each step is its own route under `/onboarding/owner/[step]`. Transitions
are explicit POSTs to `POST /onboarding/progress/advance` with a
target step id — server validates that the target is reachable
(prior step completed-or-skipped, or it's the current step).

### Step definitions

| Step                | Inputs                                              | Underlying API                                                                  | Skippable                   |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| `welcome`           | None — read-only                                    | None                                                                            | Auto-advance on click       |
| `company_basics`    | `name`, `logo?`, `description`                      | `PATCH /orgs/:orgId`                                                            | Yes                         |
| `upload_first_docs` | Files dragged onto `01_*` / `02_*` slots            | `room-and-folders` upload + `doc-checklist` slot assignment                     | Yes                         |
| `nda_template`      | NDA markdown body                                   | `access-control` `replaceNdaTemplate`                                           | Yes                         |
| `first_opportunity` | Opportunity name, expiry, tier, invitee email + msg | `room-and-folders` `createOpportunity` + `access-control` `createExternalGrant` | Yes (with explicit "later") |
| `done`              | None — summary                                      | None                                                                            | n/a                         |

### Resumability

- On any wizard route load: if user has `completed_at` → redirect
  to `/dashboard`. Else: GET `/onboarding/progress` and render the
  step matching `current_step`. The `current_step` is the first
  not-in-`completed_steps`-and-not-in-`skipped_steps` step.
- Inputs entered in a step persist via the underlying slice's API
  on every "Continue" or "Skip" press (no separate draft store).

### Done detection

Auto-fill `completed_steps` on entry to a step where the underlying
data already exists, e.g.:

- `company_basics` → completed if `org.description` non-empty.
- `nda_template` → completed if any NDA template version exists.
- `first_opportunity` → completed if any non-archived Opportunity
  exists.

That handles FR5 (don't re-prompt for completed work) and AC-US5
(no duplicate Opportunity).

## Invited-user orientation

### `/onboarding/welcome` (admin / internal)

One screen: greeting, role-appropriate tour items (Users, Grants,
Review queue), a "Got it" button → `/dashboard`.

Marks `flow='invited_editor'` or `'invited_viewer'` row complete.

### `/onboarding/welcome` (external, post-NDA)

One screen: scope (which Opportunity), what's visible/not, expiry
date, "request extension" affordance (FR7), a "Got it" button →
`/external/:slug`.

External users' progress row is created on NDA acceptance to track
"have they been here before".

## Get-started card (FR8, FR9)

Rendered by `admin-dashboard` home (slice 7) by reading:

1. `onboarding_progress.skipped_steps` for explicit todos.
2. `doc-checklist` completion < 50% for required folders.
3. `org_subscriptions.status='trialing'` + days remaining (FR9).

Items deep-link back to the right wizard step (`/onboarding/owner/<step>`).
Card hidden after `dismissed_get_started=true`.

## Sample / demo room

`/onboarding/sample-room` is a **purely client-side** route served
by the web package. No org_id involvement. Content lives in
`packages/web/app/onboarding/sample-room/_data/sample-room.json`
— a hand-curated dataset with:

- 6 canonical folders + a sample Opportunity.
- Slot states (some approved, some uploaded with AI verdicts).
- A pre-baked Q&A turn ("what's the cash runway?" → cited answer).
- Locked write affordances; clicking them shows "this is a sample,
  sign in to your real room".

Returning to the wizard: query param `?from=sample` brings the
user back to the step they were on. AC-US6.

## API additions

### `GET /onboarding/progress`

Returns the user's current progress row + computed `derived_step`.

### `POST /onboarding/progress/advance`

Body: `{ to: stepId, action: 'complete' | 'skip' }`. Validates
reachability; updates row.

### `POST /onboarding/progress/dismiss-get-started`

Sets `dismissed_get_started=true`.

### `GET /metrics/activation` (admin-only, used by dashboard)

Returns per-org: time-to-first-invite, time-to-first-green,
% of owners completed.

## Product analytics (FR12, NFR5)

Wraps PostHog browser SDK + a small server-side capturer.

Events:

- `onboarding.step_viewed { step, flow }`.
- `onboarding.step_completed { step, durationMs }`.
- `onboarding.step_skipped { step }`.
- `onboarding.completed { totalDurationMs }`.
- `onboarding.sample_room_viewed`.
- `onboarding.dismissed_get_started`.
- `activation.first_invite_sent { orgId, timeFromSignupMs }` (server).
- `activation.first_green_verdict { orgId, timeFromSignupMs }` (server).

PostHog API key in env var; no PII (use `userId` only, not email).
Privacy posture documented in `docs/privacy/posthog.md`.

## Performance

NFR3 (≤1s p95 page load): each wizard route is a React Router
entry whose `loader` issues a single API call to
`/onboarding/progress`; the result is cached client-side between
steps via the standard data-router cache. Lighthouse-CI budget
added.

## Accessibility

NFR6: WCAG 2.1 AA — wizard uses `role=tablist` + arrow-key
navigation between step indicators; form fields all labelled;
focus jumps to the first input on each step; live region announces
"step X of 6" on transition.

## Key trade-offs

- **Per-user wizard state vs. derive-from-data** — chose persisted
  state because (a) explicit "I skipped this" is different from
  "I haven't done it yet"; (b) we want to track funnel
  drop-off precisely (FR12).

- **Server-rendered steps vs. client-side wizard** — server
  components per step keep bundle tiny + give us per-route
  authorisation easily.

- **Sample room as static JSON vs. seeded fake org** — static JSON
  beats seeded org because (a) zero data lifecycle problems;
  (b) no risk of orphaned sample data after a refactor;
  (c) the "fake" presentation is more honest.

- **PostHog managed vs. self-hosted** — managed for v0.1 to ship
  quickly; revisit when first non-UK customer lands. Documented
  as a known privacy review item.

- **Force-completion vs. always-skippable** — chose always-skippable
  per requirements open question. Persistent dashboard nudges (FR8)
  carry the "you should do this" signal without blocking.

## Security

- Wizard endpoints behind the standard `requires(...)` decorator.
  Owner wizard requires `owner` role.
- No new secrets surface beyond PostHog API key (Secrets Manager).
- Sample room content has no real data; static under web package.

## Observability

**Server metrics:**

- `onboarding.step_completed{step}` — count.
- `onboarding.step_skipped{step}` — count.
- `onboarding.funnel_dropoff{from,to}` — derived gauge.
- `activation.time_to_first_invite_seconds` — histogram.
- `activation.time_to_first_green_seconds` — histogram.

**Alerts:** none at v0.1; this is product-analytics, not ops.

## Rollout

Feature flag `onboarding_v1` per-org. Default ON. Sample room
ships as a separate flag `sample_room_enabled` so we can dark-launch
the content without exposing in the wizard.

Migration: single `onboarding_progress` table.

## Open questions

- **PostHog vs. Segment vs. self-hosted** — leaning PostHog managed
  per requirements; final pick in T-001 sign-off.
- **Sample room content depth** — minimum viable depth for
  perceived realism. Iterate after first 5 customer reviews.
- **External-user request-extension affordance** — UI only at v0.1
  (mailto link); proper request workflow in Phase 2 alongside
  request-intercept-hitl.

## Sign-off

- [ ] Bradley reviewed
- [ ] Tasks phase unblocked
