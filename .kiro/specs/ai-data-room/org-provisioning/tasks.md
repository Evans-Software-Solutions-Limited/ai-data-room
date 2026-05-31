# Tasks — ai-data-room / org-provisioning

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-31

Assumes `auth-and-orgs` merged (tagged `v0.1.0-auth-and-orgs`). Executes in
`microservices/core` (`application/orgs/*`), reusing slice-1 repos + the WorkOS
client wrapper. Lands **before** `tenant-isolation` and `room-and-folders`.
Conventions: same as `auth-and-orgs/tasks.md`; 90% coverage gate.

---

## T-001 — Domain + schemas: create-org DTO + org.created event

Status: `[ ]`
**Scope:** `CreateOrgInput` zod schema (name 1–80); `org.created` event payload
type; add `org.created` + `membership.created` to `AuditEventTypeSchema`
(`application/audit.ts`).
**Files (likely):** `microservices/core/domain/org/*`,
`packages/api-utils/schemas/org.ts`, `application/audit.ts`.
**DoD:** Schemas + event type exported; audit enum extended.
**Tests required:** Unit — schema happy + failure; audit-enum includes the two
new events.

---

## T-002 — Application: createOrg transaction

Status: `[ ]`
**Scope:** `createOrg` — single-membership guard, `withTx` orchestration (WorkOS
createOrg → local `orgs` mirror → `owner` membership → `safeAudit`), emit
`org.created` on commit. Resolve the WorkOS-create-then-tx-failure
compensation.
**Files (likely):** `application/orgs/createOrg.ts`.
**DoD:** Atomic create; existing-membership rejected; audit + event emitted;
no orphan org row on simulated mid-tx failure.
**Tests required:** Unit — happy path, single-membership rejection, mid-tx
failure leaves no orphan, audit + event emitted.

---

## T-003 — Handler: POST /orgs in meRoutes

Status: `[ ]`
**Scope:** `postOrgsHandler` mounted in `meRoutes` (no `requireOrg`); maps
result to `{ orgId, role }`; rate-limited (reuse slice-1 limiter).
**Files (likely):** `application/orgs/create/postOrgsHandler.ts`,
`application/auth/protectedRoutes.ts` (mount in meRoutes).
**DoD:** Authenticated no-org user can create; existing-org user 4xx;
rate-limited.
**Tests required:** Handler tests — auth, no-org precondition, rate-limit,
response shape.

---

## T-004 — /me resolves orgId + role post-creation

Status: `[ ]`
**Scope:** Confirm `resolveActor` / `/me` returns the real `{ orgId, role:
'owner' }` once a membership exists (slice-1 lazy-mirror already supports this;
add the post-creation assertion + any wiring).
**Files (likely):** `application/auth/guards/resolveActor.ts` (verify),
`application/auth/user/getUserHandler.ts`.
**DoD:** `/me` flips from `{ orgId: null }` to the new org immediately after
creation.
**Tests required:** Integration — create org → `/me` reflects orgId + owner.

---

## T-005 — Provisioning handoff contract (consumed by room-and-folders)

Status: `[ ]`
**Scope:** Emit `org.created` to EventBridge with the documented payload; define
the idempotent-subscriber contract that `room-and-folders` implements (keyed on
`org_id`, no-op if canonical folders exist). This task owns the **producer +
contract**; `room-and-folders` owns the consumer.
**Files (likely):** `application/orgs/createOrg.ts` (emit), `infra/*` (rule),
contract note in `room-and-folders` integration.
**DoD:** `org.created` emitted post-commit; contract documented; redelivery is
safe by contract.
**Tests required:** Unit — event emitted once on commit, not on rollback.

---

## T-006 — Observability + slice sign-off

Status: `[ ]`
**Scope:** create-count / latency / failures / room-handoff metrics + alarms;
traceability matrix; sign-off; tag.
**Files (likely):** `infrastructure/observability/metrics.ts`, `infra/*`,
`docs/slices/org-provisioning.md`.
**DoD:** Metrics emit; matrix complete; sign-off merged.
**Tests required:** Unit — metric emission; CI green across the slice.
