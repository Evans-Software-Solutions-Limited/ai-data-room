# Requirements — ai-data-room / notifications

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-05-31
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `auth-and-orgs`; consumes events from `room-and-folders`,
`access-control`, `ai-doc-sensecheck`, `ai-search-qna`

## Context

The product's stickiness story — the activity feed, the weekly digest, the
"someone accessed your document" awareness — is referenced across the
`onboarding-flow` and `admin-dashboard` specs as a future "product-email slice"
but has never been scoped. Transactional auth emails (verification, password
reset, invitations) are owned by WorkOS/AuthKit. This slice owns **product
notifications**: the in-app notification centre and the outbound email
(immediate alerts + a weekly digest) that keep room owners aware of what's
happening without logging in.

## Users & roles

- **Primary:** owner/admin who wants to know when something noteworthy happens
  in their room (external access, AI flags, expiring invites).
- **Secondary:** internal contributors (lighter set); external viewers get only
  the transactional emails they already receive via `access-control`.
- **Roles (from `auth-and-orgs`):** all internal roles can receive
  notifications, governed by per-user preferences.

## User stories

- **US1** — _As an owner, I want an email the moment a high-signal event happens
  (an external viewer downloaded a doc, an NDA was signed, an AI flag was
  raised) so I don't have to watch the dashboard._
- **US2** — _As an admin, I want a weekly digest summarising room activity so I
  get a calm overview without per-event noise._
- **US3** — _As any internal user, I want an in-app notification centre showing
  recent events relevant to me, with read/unread state._
- **US4** — _As a user, I want to control which notifications I get (per
  category, immediate vs. digest vs. off) so the product doesn't spam me._
- **US5** — _As an owner, I want to be reminded before a pending invite or a
  date-expiring grant lapses._

## Functional requirements

### Event ingestion

- **FR1** — The slice shall subscribe to domain events already emitted by other
  slices (e.g. `document.downloaded`, `nda.signed`, `slot.flagged`,
  `grant.expiring`, `invitation.expiring`, `qna.flagged`) via the existing
  EventBridge bus — it shall not require source slices to call it directly.
- **FR2** — Each event type shall map to a **notification category** (Access,
  AI, Checklist, Membership, Billing) with a default delivery policy
  (immediate / digest / off).

### Delivery channels

- **FR3** — **In-app notification centre:** per-user feed with read/unread,
  mark-all-read, and deep links to the relevant screen.
- **FR4** — **Immediate email:** for categories the user has set to immediate;
  rate-limited and coalesced (no more than one email per user per N minutes;
  bursts batch into one).
- **FR5** — **Weekly digest email:** a scheduled per-org/per-user summary
  (activity counts, top flags, expiring items), matching the design brief's
  "what happened in your room this week" template.
- **FR6** — All product emails shall be brandable (`datum/room` template),
  carry an unsubscribe/manage-preferences link, and respect suppression.

### Preferences

- **FR7** — Per-user notification preferences (per category × channel) with
  sensible defaults; changeable in settings; honoured on every send.
- **FR8** — Hard suppression list (bounces, complaints, unsubscribes) shall be
  honoured and never overridden by preferences.

### Audit & idempotency

- **FR9** — Notification sends shall be idempotent per (event, user, channel)
  so event redelivery does not double-send.
- **FR10** — Sends shall be logged (not necessarily full audit events) with
  delivery outcome for support/debugging.

## Non-functional requirements

- **NFR1** — Immediate notifications shall be delivered within ≤2 min of the
  source event p95.
- **NFR2** — Email shall go through one provider abstraction (SES or
  equivalent) behind an interface, so the provider can be swapped without
  touching senders.
- **NFR3** — Notification data shall be tenant-scoped (`tenant-isolation`); no
  user ever sees another org's events.
- **NFR4** — The digest job shall be safely re-runnable (idempotent per period)
  and shall not send empty digests.
- **NFR5** — PII in emails shall follow the same redaction-from-logs rules as
  `auth-and-orgs` NFR8.

## Acceptance criteria

- **AC-US1** — An external download triggers an immediate email to the
  owner/admins who opted in, within 2 minutes, with a deep link.
- **AC-US2** — The weekly digest sends once per period with correct counts and
  no email when there was zero activity.
- **AC-US3** — The in-app centre shows new events with unread state; opening one
  marks it read and deep-links correctly.
- **AC-US4** — Setting a category to "digest only" stops immediate emails for it
  but still includes it in the weekly digest.
- **AC-US5** — Unsubscribing suppresses all non-transactional email regardless
  of preferences; transactional auth email is unaffected.
- **AC-US6** — Redelivering the same source event does not produce a second
  notification.

## Non-goals (for this slice)

- Transactional auth emails (verification, reset, invitation) → owned by
  WorkOS/`auth-and-orgs`.
- SMS / push / Slack / webhook delivery → Phase 2.
- Marketing / lifecycle email sequences → Phase 2 (`onboarding-flow` notes a
  separate product-email sequence).
- External-viewer activity digests → Phase 2.

## Open questions

- Email provider: SES (in-AWS, cheap, fits the stack) vs. a deliverability-
  managed provider (Postmark/Resend). Leaning SES at v0.1 behind the interface;
  revisit if deliverability needs managed reputation.
- Digest cadence/anchor: fixed weekly (e.g. Monday 08:00 org-local) vs.
  per-user configurable. Leaning fixed weekly at v0.1.
- Do `internal` contributors get the access-alert category by default, or only
  owner/admin? Leaning owner/admin default, opt-in for internal.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
