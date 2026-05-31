# Tasks — ai-data-room / notifications

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-31

Assumes `auth-and-orgs` + `tenant-isolation` merged and that source slices emit
their domain events. Executes in `microservices/core`, a
`microservices/workers` worker, `packages/web`, and `infra`. 90% coverage gate.

---

## T-001 — Migrations + domain: notifications, prefs, sends, suppressions

Status: `[ ]`
**Scope:** Four tenant-scoped tables + domain types; the event→category map
(versioned code table).
**Files (likely):** `packages/db/schema/notifications.ts`, migrations,
`microservices/core/domain/notifications/*`.
**DoD:** Migrations apply; tables scoped; category map unit-covered.
**Tests required:** Integration (apply + scoped); unit (map completeness — every
known notifiable event maps to a category).

---

## T-002 — Infrastructure: repos + email provider interface (SES)

Status: `[ ]`
**Scope:** `NotificationRepo`, `PreferenceRepo`, `SuppressionRepo`,
`SendLedgerRepo` via `scopedRepo`; `EmailProvider` interface + SES impl; branded
template renderer.
**Files (likely):** `infrastructure/db/*Repo.ts`,
`infrastructure/email/{provider,ses,templates}.ts`, `infra/email.ts`.
**DoD:** Provider swappable behind interface; suppression checked in the send
path; template renders.
**Tests required:** Unit — provider interface mock; suppression enforced;
template snapshot.

---

## T-003 — EventBridge rule + SQS + notify-worker

Status: `[ ]`
**Scope:** Subscribe notifiable events → SQS → worker that resolves recipients,
applies prefs/suppression/idempotency, writes in-app rows, sends coalesced
immediate email.
**Files (likely):** `microservices/workers/src/notifications/notifyWorker.ts`,
`infra/notifications.ts`.
**DoD:** A test event produces an in-app row + (if immediate) one email;
redelivery is idempotent; bursts coalesce.
**Tests required:** Unit — recipient resolution, idempotency, coalescing;
integration — event→in-app+email.

---

## T-004 — Application: notification centre API + preferences

Status: `[ ]`
**Scope:** Feed list (own, paged), mark read, get/update preferences, signed
unsubscribe endpoint.
**Files (likely):** `application/notifications/*`.
**DoD:** Own-feed only; prefs honoured; unsubscribe suppresses + is signed.
**Tests required:** Unit — own-scope enforcement, prefs CRUD, unsubscribe token
validation.

---

## T-005 — Scheduled weekly digest worker

Status: `[ ]`
**Scope:** Per-org scheduled job aggregating the period, rendering the digest,
sending; idempotent per period; skips empty.
**Files (likely):** `microservices/workers/src/notifications/digestWorker.ts`,
`infra/*` (schedule).
**DoD:** Digest sends once per period with correct counts; no empty digests;
re-run safe.
**Tests required:** Unit — aggregation + empty-skip + idempotency; integration —
scheduled run produces one digest.

---

## T-006 — Web: notification centre + preferences UI

Status: `[ ]`
**Scope:** In-app notification centre (bell + dropdown/page, unread badge,
deep links), preferences screen. AI-category items use `signal` amber per the
design system.
**Files (likely):** `packages/web/src/components/Notifications/*`,
`packages/web/src/pages/NotificationPreferences.tsx`.
**DoD:** Feed renders with read/unread; deep links work; prefs editable.
**Tests required:** Component tests (feed, read state, prefs).

---

## T-007 — Observability + NFR hardening

Status: `[ ]`
**Scope:** Send/coalesce/suppress/latency/bounce metrics; alarms; PII-in-logs
redaction pass; tenant-scope hardening.
**Files (likely):** `infrastructure/observability/metrics.ts`, `infra/*`.
**DoD:** Metrics emit; alarms wired; NFR matrix complete.
**Tests required:** Unit — metric emission; redaction assertions.

---

## T-008 — Playwright acceptance + slice sign-off

Status: `[ ]`
**Scope:** E2E: trigger an event → in-app notification appears + email queued;
unsubscribe suppresses. Traceability matrix; sign-off; tag.
**Files (likely):** `e2e/specs/notifications/*`, `docs/slices/notifications.md`.
**DoD:** E2E green; matrix complete; sign-off merged.
**Tests required:** Playwright suite; CI green.
