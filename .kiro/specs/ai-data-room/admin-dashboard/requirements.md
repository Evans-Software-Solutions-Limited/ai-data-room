# Requirements — ai-data-room / admin-dashboard

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-04-21
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `auth-and-orgs`, `room-and-folders`, `access-control`, `doc-checklist`, `ai-doc-sensecheck`, `ai-search-qna`

## Context

The admin dashboard is where owners and editors manage their room. It
does **not add new functionality** — every earlier slice's API is
already shipped by the time this slice begins. This slice is the
**unifying UI** that lets a human see room state at a glance, run the
management actions the earlier slices expose, and answer "what's going
on with my data room?" without touching a database.

Treating this as a pure UI slice keeps the backend APIs clean and lets
us ship the earlier slices as headless-capable before we invest in the
admin UX.

## Users & roles

- **Primary user:** owner or admin.
- **Secondary users:** internal user (read-only dashboards for their
  org); external users never access this surface.
- **Roles:** as defined in `auth-and-orgs`. Gating: `viewer` users
  see a reduced view; `external` users are redirected to their
  Opportunity subroom UI.

## User stories

- **US1** — _As an owner, I want a room overview landing page showing
  completion %, active grants, recent activity, and open review
  queue — so I know where to focus._
- **US2** — _As an admin, I want a users page listing everyone with
  access to the org (internal + external), their role, lifecycle
  state, MFA status, and last-active — so I can spot stale accounts._
- **US3** — _As an admin, I want to suspend, un-suspend, or delete a
  user inline from the users page._
- **US4** — _As an admin, I want an invitations page showing all
  pending invites with status, expiry, and a revoke button — so I
  can close the loop on people who didn't accept._
- **US5** — _As an admin, I want a grants page listing external
  access grants by Opportunity, with expiring-soon highlighted —
  so I can extend or revoke before access lapses._
- **US6** — _As an admin, I want a review queue showing uploads the
  AI flagged for human review — so I can clear them without hunting
  through folders._
- **US7** — _As an admin, I want a Q&A activity page showing recent
  questions asked by external viewers and what they were answered
  with — for compliance visibility._
- **US8** — _As an admin, I want an audit log view with filters by
  user, event type, and time range — so I can investigate incidents._
- **US9** — _As an owner, I want a settings page to edit NDA text,
  customise checklist templates, manage the org's billing plan, and
  toggle `auto_approve_green` for AI sensecheck._

## Functional requirements

### Overview / home

- **FR1** — The dashboard home shall render:
  - Room-level completion percentage (from `doc-checklist` FR9).
  - Per-canonical-folder completion.
  - Active external grants count + expiring-within-7-days count.
  - Review queue size.
  - Recent activity (last 20 auditable events relevant to the org).
- **FR2** — The dashboard home shall load in ≤1s p95 with the
  above data populated (cached where sensible).

### Users

- **FR3** — Users page shall list every user in the org
  (memberships + external grants), showing: email, full name, role,
  lifecycle state, MFA enrolment, last-active-at, active grants
  count (for external users). Filterable by role, state,
  MFA-missing, last-active-within.
- **FR4** — Inline actions on a user: suspend, un-suspend, delete
  (GDPR), resend invite, resend MFA enrolment, reset password (all
  delegating to the underlying slice APIs).

### Invitations

- **FR5** — Invitations page shall list invitations with: email,
  kind (internal/external), role or Opportunity scope, invited-by,
  invited-at, expires-at, status.
- **FR6** — Inline actions: revoke (for `pending`), re-send (for
  `pending` — new token, new expiry).

### Grants

- **FR7** — Grants page shall list external access grants, grouped
  by Opportunity. Shown columns: user, permission tier, status,
  expires-at, granted-by, granted-at, last-activity-at.
- **FR8** — Inline actions: revoke, extend expiry, change permission
  tier, view activity trail.
- **FR9** — Filters: by Opportunity, by status, by
  expiring-within-N-days, by tier.

### Review queue (AI sensecheck)

- **FR10** — Queue page shall show flagged uploads from
  `ai-doc-sensecheck`. Per-item UI: document preview, slot, AI
  verdict + confidence + rationale, matched/missing criteria,
  uploader, buttons: approve / reject + reason / re-run AI.
- **FR11** — Items cleared from the queue shall persist their
  decision history (AI verdict + admin decision + timestamp) and
  remain searchable.

### Q&A activity

- **FR12** — Activity page shall show the last 90 days of Q&A
  events (via `ai-search-qna` FR12) with: asker, scope (org or
  Opportunity), question, cited docs, unanswered flag, timestamp.
- **FR13** — Clicking an activity row shall expand to show the
  full answer and the original cited passages, honouring
  `access-control` (i.e. if the admin themselves doesn't have
  visibility, the expansion is blocked).

### Audit log

- **FR14** — Audit log page shall expose `auth-and-orgs`'s audit
  store with filters by: event type, actor user, target user,
  outcome, source IP, time range. Paged. CSV export.
- **FR15** — The UI shall render each event with a human-readable
  summary (e.g. "Alice invited bob@… as admin on 2026-04-15 10:02")
  while keeping the raw event expandable.

### Settings

- **FR16** — Settings page shall expose (tabbed):
  - **Org** — name, slug (display only), billing contact email.
  - **NDA template** — edit plaintext/markdown; show version history
    (from `access-control` FR7).
  - **Checklist templates** — view and edit the six canonical
    folder templates + Opportunity default template.
  - **AI sensecheck** — `auto_approve_green` toggle, per-slot
    criteria edit (deep link to `doc-checklist` + `ai-doc-sensecheck`).
  - **Billing** — deep link / embed of `billing-subscription`
    self-serve UI (plan, invoices, payment method).
  - **Members & roles** — deep link to Users page (FR3).

### Internal-user read-only view

- **FR17** — Users with role `viewer` shall see the dashboard
  Home, Users, Invitations, Grants (read-only), and Review queue
  (read-only on AI verdict, no approve/reject). All write actions
  are disabled in the UI and blocked at the API (enforcement lives
  in earlier slices; this slice displays the affordances correctly).

## Non-functional requirements

- **NFR1** — All pages shall be keyboard-accessible (WCAG 2.1 AA
  minimum).
- **NFR2** — All pages shall render correctly on mobile viewport
  ≥375px wide (responsive). Editing NDA text on mobile is
  best-effort.
- **NFR3** — No list view shall make more than **3 API calls** on
  initial load; aggregated endpoints added to earlier slices where
  needed rather than N+1 fan-out from the UI.
- **NFR4** — The UI shall surface the **source-of-truth page** from
  the relevant slice for any entity (e.g. clicking a document in a
  queue opens `room-and-folders`'s document detail page), avoiding
  duplicate rendering logic.
- **NFR5** — Error states shall be explicit, actionable, and
  avoid leaking implementation detail (no stack traces in UI; "try
  again" / "contact support" with a correlation id).
- **NFR6** — The UI shall be bundle-size-budgeted: initial JS ≤200KB
  gzipped, images optimised, critical CSS inlined.

## Acceptance criteria

- **AC-US1** — An owner loading the dashboard sees the five home-page
  widgets populated with correct data within 1s p95; numbers match
  reality (spot-check with manual queries).
- **AC-US2** — Users page lists every internal + external user
  accurately; last-active-at reflects the most recent login per
  audit events.
- **AC-US3** — Inline suspend on a user transitions lifecycle state
  within 1 minute (FR21 from `auth-and-orgs`); UI reflects the new
  state on refresh.
- **AC-US4** — Invitations page shows all pending invites; revoking
  one from the UI propagates to the underlying WorkOS/DB state and
  the invite becomes unusable.
- **AC-US5** — Grants page shows an expiring grant highlighted
  within the expiring-soon window; extending expiry from the UI
  persists.
- **AC-US6** — Review queue shows exactly the items flagged by
  `ai-doc-sensecheck` (not auto-approved). Approving clears the
  item and transitions the slot.
- **AC-US7** — Q&A activity page shows recent Q&A turns; unanswered
  questions are visibly flagged.
- **AC-US8** — Audit log filters return consistent results; CSV
  export of a filtered view contains the same rows shown in the UI.
- **AC-US9** — Settings → NDA template edit creates a new NDA
  version; existing accepted grants continue to reference the old
  version; new invites use the new one.

## Non-goals (for this slice)

- Adding any new domain capability beyond UI over existing slices.
- Admin notification email digest — Phase 2 (product-email slice).
- Custom dashboard widgets / user-configurable landing page — Phase 2.
- Embedded BI / chart builder — Phase 2.
- Role/permission authoring UI (creating new roles) — Phase 2.
- Multi-org admin view (switch orgs) — Phase 2 / never at v0.1.
- Mobile-native app — Phase 2; responsive web only at v0.1.
- PDF-print-friendly views — Phase 2.

## Open questions

- Do we build dashboard as its own package or co-locate pages with
  the respective slice's web routes? Leaning **separate
  `/dashboard/*` path inside the `web` package** — single app,
  single auth session — but the _page components_ for users, grants,
  etc. live in the slice that owns the data.
- Do we offer per-admin **favourites** / pinned entities in this
  slice, or punt? Leaning **punt** — speculative; wait for user
  request.
- Should the activity / audit pages support **live updates** (SSE /
  websockets)? Leaning **no at v0.1** — poll on focus; websockets
  add infra for marginal UX gain pre-scale.
- CSV export vs. Excel — CSV is simpler and covers 90% of the
  audit-export ask. Leaning **CSV only at v0.1**.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
