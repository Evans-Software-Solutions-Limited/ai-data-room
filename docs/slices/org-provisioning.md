# org-provisioning — slice 17 traceability

**Slice:** org-provisioning ·
[requirements](../../.kiro/specs/ai-data-room/org-provisioning/requirements.md) ·
[design](../../.kiro/specs/ai-data-room/org-provisioning/design.md) ·
[tasks](../../.kiro/specs/ai-data-room/org-provisioning/tasks.md)
**ADRs in force:**
[ADR-001 (WorkOS)](../../adr/001-workos-as-auth-platform.md) ·
[ADR-002 (Postgres)](../../adr/002-postgres-for-auth-domain.md) ·
[ADR-012 (role vocabulary)](../../adr/012-role-vocabulary.md)
**Depends on:** `auth-and-orgs` (tagged `v0.1.0-auth-and-orgs`).
**Hands off to:** `room-and-folders` (consumes `org.created`),
`tenant-isolation` (ADR-011 backfills the query-time guard onto this
slice's `createOrg` repos).
**Status:** sign-off ready (T-006).

## How to read this doc

Each row maps a requirement to its **implementation site** (the
production code that satisfies it) and its **verification site** (the
test that asserts it, run in CI). Rows are honest — where an AC is owned
by a not-yet-built downstream slice, or rests on a deferred backstop, the
row says so rather than inventing coverage.

This is a deliberately thin slice: it owns the create-org **mechanism**
(`POST /orgs` → WorkOS org + local mirror + owner membership + audit +
`org.created`). The guided-wizard UX is `onboarding-flow` (slice 9); the
room-provisioning subscriber is `room-and-folders` (slice 2).

---

## Functional requirements (FR)

| Req     | Summary                                                                  | Implementation                                                                                                                                                                                                                                                                                  | Verification                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR1** | Authenticated no-membership user creates an org by name (1–80 chars)     | [`postOrgsHandler.ts`](../../microservices/core/src/application/orgs/create/postOrgsHandler.ts) (`POST /orgs`, body validated by `CreateOrgInputSchema`) → [`createOrg.ts`](../../microservices/core/src/application/orgs/createOrg.ts)                                                         | [`protectedRoutes.test.ts`](../../microservices/core/src/application/auth/__tests__/protectedRoutes.test.ts) (`POST /orgs` 201), [`org.test.ts`](../../packages/api-utils/src/schemas/__tests__/org.test.ts) (DTO bounds)                                                                                                                      |
| **FR2** | One `withTx` tx: local `orgs` mirror + `owner` membership + audit events | `createOrg` — `db.transaction` wraps `orgRepo.create` (slug-deduped) + `membershipRepo.create`; `safeAudit` writes `org_created` + `membership_created` post-commit                                                                                                                             | [`createOrg.test.ts`](../../microservices/core/src/application/orgs/__tests__/createOrg.test.ts) (happy path asserts the call order + both audit rows)                                                                                                                                                                                         |
| **FR3** | On success, fire `org.created` for the canonical-room subscriber         | `createOrg` emits `org.created` post-commit via the injected `OrgEventPublisher`; transport is EventBridge ([`eventBridgeOrgEventPublisher.ts`](../../microservices/core/src/infrastructure/events/eventBridgeOrgEventPublisher.ts)) onto the bus in [`infra/events.ts`](../../infra/events.ts) | [`createOrg.test.ts`](../../microservices/core/src/application/orgs/__tests__/createOrg.test.ts) (emit-once-on-commit), [`eventBridgeOrgEventPublisher.test.ts`](../../microservices/core/src/infrastructure/events/__tests__/eventBridgeOrgEventPublisher.test.ts) (PutEvents contract). **Consumer owned by `room-and-folders` — see gaps.** |
| **FR4** | After creation `/me` resolves `{ orgId, role: 'owner' }`                 | `resolveActor` resolves `localOrgId` via the membership the tx just wrote (slice-1 lazy-mirror + `membershipRepo.findByUser` fallback); `/me` narrows to the canonical shape                                                                                                                    | [`resolveActor.test.ts`](../../microservices/core/src/application/auth/guards/__tests__/resolveActor.test.ts), [`protectedRoutes.test.ts`](../../microservices/core/src/application/auth/__tests__/protectedRoutes.test.ts) (`/me` post-create)                                                                                                |
| **FR5** | A user with a membership is rejected from creating a second org          | Handler fast-path on `actor.localOrgId`; `createOrg` re-checks via `pg_advisory_xact_lock` (`membershipRepo.lockForUserCreate`) + in-tx `findByUser` re-check (no `UNIQUE(user_id)`) — both route through `recordCreateOrgFailure`                                                              | [`createOrg.test.ts`](../../microservices/core/src/application/orgs/__tests__/createOrg.test.ts) (pre-tx reject + in-tx race reject + compensation), [`protectedRoutes.test.ts`](../../microservices/core/src/application/auth/__tests__/protectedRoutes.test.ts) (409 fast-path)                                                              |
| **FR6** | Emit `org.created` + `membership.created` audit events                   | `safeAudit` writes both via `recordAuditEvent` (the only sanctioned writer); event types added to `AuditEventTypeSchema` in T-001                                                                                                                                                               | [`createOrg.test.ts`](../../microservices/core/src/application/orgs/__tests__/createOrg.test.ts) (audit shapes), [`auth-orgs.test.ts`](../../packages/api-utils/src/schemas/__tests__/auth-orgs.test.ts) (enum count 21→23)                                                                                                                    |

---

## Non-functional requirements (NFR)

| NFR      | Summary                                                 | How it's met                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NFR1** | Atomic create — no half-provisioned state               | Single `withTx`; a mid-tx failure rolls back the `orgs` + membership writes together. The pre-tx WorkOS org is **compensated** (best-effort `deleteOrganization`) so a tx failure leaves no orphan. Covered by `createOrg.test.ts` (mid-tx-failure-leaves-no-orphan, compensation, compensation-also-fails).                                                                                 |
| **NFR2** | `org.created` → room-provisioning handoff is idempotent | EventBridge is at-least-once; the producer makes **no** exactly-once guarantee. The room-provisioning subscriber keys on `org_id` and no-ops if the canonical folders already exist, so a redelivery can't duplicate. Owned by `room-and-folders`; see the contract below.                                                                                                                   |
| **NFR3** | All rows carry `org_id` from birth                      | The membership + org rows are written with the new `org_id` in-tx. The query-time tenant **guard** (ADR-011) ships in `tenant-isolation` (slice 10); ADR-011 lists this slice's `createOrg` repos in its "backfill the guard" set. Until then isolation rests on application-layer checks — acceptable: `createOrg` only writes the creator's own org + membership (no cross-org read path). |
| **NFR4** | Org creation is rate-limited                            | `orgRoutes` applies `ORG_CREATE_RATE_LIMIT` (5/IP/min) as a route-local `.onBeforeHandle` (`rateLimitBeforeHandle`) so it can't throttle sibling routes like `/me`. Covered by `protectedRoutes.test.ts` (rate-limit + `/me`-not-throttled).                                                                                                                                                 |

---

## Provisioning handoff contract (canonical)

This is the contract `room-and-folders` implements as the `org.created`
subscriber. (The producer half lives in
[`eventBridgeOrgEventPublisher.ts`](../../microservices/core/src/infrastructure/events/eventBridgeOrgEventPublisher.ts).)

| Field           | Value                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------- |
| **Bus**         | `CoreEventBus` ([`infra/events.ts`](../../infra/events.ts)) — one bus per stage                 |
| **Source**      | `ai-data-room.core` (`CORE_EVENT_SOURCE`) — informational                                       |
| **Detail-type** | `org.created` (`ORG_CREATED_DETAIL_TYPE`) — the routing key the subscriber matches on           |
| **Detail**      | `{ orgId, workosOrgId, ownerUserId }` (`OrgCreatedEvent`, validated by `OrgCreatedEventSchema`) |

**Subscriber obligations (NFR2):** match on the detail-type; key
idempotency on `orgId`; no-op if the canonical folders already exist.
EventBridge delivers **at-least-once**, so the subscriber MUST tolerate
redelivery. The dotted `org.created` detail-type is deliberately distinct
from the snake_case `org_created` **audit** event type — two channels, do
not unify.

---

## Observability (T-006)

Metrics emitted from the core API Lambda (`service: "core-api"`,
namespace `AiDataRoom/Auth`), per design.md §Observability:

| Metric                              | Emitted by                                | Alarm                                                                                                   |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `org.created.count`                 | `createOrg` (success)                     | — (volume, dashboard only)                                                                              |
| `org.create.latency_ms`             | `createOrg` (success)                     | — (added in T-006 to complete design's metric set; no alarm spec'd)                                     |
| `org.create.failures`               | `recordCreateOrgFailure` (all paths)      | **alarm 6** — anomaly-detection spike (benign FR5 rejections share this metric, so `>0` would be noisy) |
| `org.create.slug_conflict_retry`    | `createOrg` (bounded retry)               | — (volume, dashboard only)                                                                              |
| `org.create.compensation_failed`    | `createOrg` (orphaned WorkOS org)         | **alarm 8** — `>0` (never benign; needs manual reconciliation)                                          |
| `org.provision.room_handoff_ok`     | EventBridge publisher (success)           | — (volume)                                                                                              |
| `org.provision.room_handoff_failed` | EventBridge publisher / `createOrg` catch | **alarm 7** — `>0` (publish failed; room may be un-provisioned)                                         |

Alarms wired in [`infra/observability.ts`](../../infra/observability.ts)
(numbered 6–8, after the four slice-1 alarms). The design's
"room_handoff **retries** climbing" alarm is a **consumer-side** signal
(subscriber stuck) and lands with `room-and-folders`; this slice wires the
**producer-side** publish-failure half.

---

## Acceptance criteria (AC)

| AC         | Summary                                                     | Coverage                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-US1** | `orgId: null` user creates "Acme Ltd" → 201 + new org       | ✅ `protectedRoutes.test.ts` (`POST /orgs` 201 returns `{ orgId, role }`)                                                                                                 |
| **AC-US2** | Immediately after, `/me` returns `{ orgId, role: 'owner' }` | ✅ `protectedRoutes.test.ts` (`/me` reflects the new membership); `resolveActor.test.ts`                                                                                  |
| **AC-US3** | The canonical six-folder room exists for the new org        | ⏸️ **Owned by `room-and-folders` (slice 2, not yet built).** This slice fires + tests the `org.created` trigger; the folder-creation assertion lands in slice 2's matrix. |
| **AC-US4** | A user who already belongs to an org is rejected            | ✅ `protectedRoutes.test.ts` (409 fast-path) + `createOrg.test.ts` (DB re-check + in-tx race)                                                                             |
| **AC-US5** | A simulated mid-tx failure leaves no orphan org row         | ✅ `createOrg.test.ts` (mid-tx-failure + WorkOS compensation paths)                                                                                                       |
| **AC-US6** | `org.created` + `membership.created` audit events recorded  | ✅ `createOrg.test.ts` (both audit rows on success); `auth-orgs.test.ts` (enum)                                                                                           |

---

## Resolved design questions

The design.md "Open questions" are resolved as follows (annotated there too):

- **WorkOS-create-then-DB-tx ordering / compensation** → **compensate.**
  The WorkOS org is created pre-tx (its id mirrors into the local row); a
  subsequent tx failure best-effort-deletes the WorkOS org. If the delete
  also fails it's logged + metered (`org.create.compensation_failed`,
  alarm 8) for manual reconciliation. Chosen over "accept a logged orphan"
  because an orphan could later collide or be mistaken for a real tenant.
  Implemented in `createOrg.ts` (T-002).
- **Emit reliability** → **post-commit, best-effort, idempotent
  consumer.** `org.created` is emitted after the tx commits (the org
  already exists), so a publish failure must not fail the request — it's
  logged + metered (`org.provision.room_handoff_failed`, alarm 7), and
  the consumer's `org_id` idempotency (NFR2) makes a reconciliation replay
  safe. EventBridge's at-least-once delivery is acceptable precisely
  because the consumer is idempotent. Resolved in T-005.
- **`POST /orgs` accepts inline invites?** → **No, org-only.** Invites
  compose via `access-control` + the slice-9 wizard.

---

## FR-coverage gaps (acknowledged)

| Gap                                                | Why                                                                                                                                                                            | Owner / unblock                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **FR3 / AC-US3** — canonical room actually created | This slice owns + tests the `org.created` **trigger**; the subscriber that creates the six folders lives in `room-and-folders` (slice 2), which isn't built yet.               | `room-and-folders` owner. Re-cite in slice 2's matrix when the subscriber lands. |
| **NFR3** — query-time tenant guard on these repos  | The guard (ADR-011) ships in `tenant-isolation` (slice 10). This slice's `createOrg` repos are in ADR-011's "backfill the guard" set. Safe in the interim (no cross-org read). | `tenant-isolation` owner. Backfill + re-cite in slice 10's matrix.               |
| **Consumer-side `room_handoff` retry alarm**       | "Retries climbing → subscriber stuck" is a consumer signal; the producer can't see consumer retries. Producer-side publish-failure alarm (alarm 7) is wired here.              | `room-and-folders` owner, when the subscriber + its retry metric land.           |

---

## Deploy checklist (T-006)

- ✅ `bun run typecheck` green (infra + per-workspace).
- ✅ `bun run test` green (unit + integration).
- ✅ `bun run lint` + `bun run prettier:check` clean.
- ✅ Branch-per-task discipline (T-005 + T-006 bundled in one PR per Brad's
  "bundle within a cohesive feature").
- ⚠️ **First EventBridge infra.** `bun sst diff --stage <stage>` run
  before the PR pushed (CLAUDE.md non-negotiable #7) — the infra
  typecheck shim types `sst.aws.*` as `any` and can't catch a wrong
  component name.
- 🟦 **`CoreEventBus` per stage.** SST creates the bus on first
  `sst deploy`; no secret/value to provision. The hand-added
  `sst-env.d.ts` `CoreEventBus` stanza is replaced identically on the next
  `bun sst dev`/`deploy` regen.
- 🟦 **SNS subscriber for the alarm topic** still console-configured
  per stage (same as slice 1) — production-cutover step.
- 🟦 **Tag** `v0.2.0-org-provisioning` applied **post-merge** once CI is
  green on `main` (release-please drives versioning; tag per slice).

---

## Tasks

| Task  | Summary                                            | Status                      |
| ----- | -------------------------------------------------- | --------------------------- |
| T-000 | Role-vocabulary migration (admin→editor, …)        | ✅ #33                      |
| T-001 | create-org DTO + `org.created` event + audit types | ✅ #34                      |
| T-002 | `createOrg` transaction                            | ✅ #35                      |
| T-003 | `POST /orgs` handler                               | ✅ #35                      |
| T-004 | `/me` resolves orgId + role post-creation          | ✅ #35                      |
| T-005 | EventBridge `org.created` transport + contract     | ✅ this PR                  |
| T-006 | Observability alarms + this traceability doc + tag | ✅ this PR (tag post-merge) |
