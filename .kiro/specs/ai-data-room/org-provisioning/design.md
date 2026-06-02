# Design — ai-data-room / org-provisioning

**Status:** signed off (Bradley, 2026-05-31)
**Requirements:** [./requirements.md](./requirements.md)
**Last updated:** 2026-05-31
**Depends on:** `auth-and-orgs`; hands off to `room-and-folders`,
`tenant-isolation`

## Summary

A thin, atomic create-org path: an authenticated actor with no membership calls
`POST /orgs`; the application layer creates the WorkOS org, mirrors it to a
local `orgs` row, creates the creator's `owner` membership, and emits
`org.created` — all in one `withTx` transaction. `room-and-folders` consumes
`org.created` to provision the canonical six folders (idempotently). After this,
`resolveActor`/`/me` resolves a real `{ orgId, role: 'owner' }` instead of the
slice-1 `{ orgId: null }` lazy-mirror state. This slice deliberately owns only
the _mechanism_; `onboarding-flow` (slice 9) wraps it in guided UX.

## Architecture

```mermaid
flowchart LR
  User[authenticated, orgId:null] --> API[POST /orgs in meRoutes]
  API --> Guard[reject if membership exists]
  Guard --> Tx[withTx transaction]
  Tx --> WOS[WorkOS organizations.createOrg]
  Tx --> OrgRow[orgs row: mirror workos id → local uuid]
  Tx --> Mem[membership: owner]
  Tx --> Audit[safeAudit: org.created + membership.created]
  Tx --> Event[emit org.created → EventBridge]
  Event --> RF[room-and-folders: provision canonical room idempotently]
  API --> Me[/me now resolves orgId + role]
```

## Where it lives (layered architecture)

- **Route:** `application/orgs/create/postOrgsHandler.ts`, mounted in
  **`meRoutes`** (not `orgScopedRoutes`) — the caller has no org context at
  creation time, so it must not sit behind `requireOrg` (sticky #36).
- **Application:** `application/orgs/createOrg.ts` — the transactional
  orchestration (WorkOS + repos + audit + event).
- **Infrastructure:** reuses `orgRepo`, `membershipRepo` (now via the
  `tenant-isolation` factory once that lands), and the `workos` client wrapper.
- HTTP route is application-layer per sticky #27; `handlers/` stays webhook-only.

## Data model

No new tables — reuses `auth-and-orgs`' `orgs` + `org_memberships`. Adds no
columns. (The `org.created` event payload is `{ orgId, workosOrgId, ownerUserId
}`.)

## Provisioning handoff

- This slice emits `org.created`; `room-and-folders` owns the subscriber that
  creates the six canonical folders. The dependency is one-directional
  (provisioning depends on org-creation, never the reverse).
- **Idempotency (NFR2):** the room-provisioning subscriber keys off `org_id` and
  no-ops if the canonical folders already exist, so an `org.created` redelivery
  cannot duplicate folders.

## Interfaces

| Method | Path    | Purpose                                                      |
| ------ | ------- | ------------------------------------------------------------ |
| `POST` | `/orgs` | Create the caller's organisation (name in body). `meRoutes`. |

Returns `{ orgId, role: 'owner' }`. Subsequent `/me` reflects the same.

## Transaction (the correctness core)

`createOrg` runs inside `withTx` (sticky #15), awaits sequential:

1. `workos.createOrganization(name)` → WorkOS org id. _(External call —
   performed before the DB writes; if the DB tx then fails, a compensating
   cleanup or an accepted orphaned-WorkOS-org is logged. Resolve the exact
   ordering in T-002 — see open questions.)_
2. `orgRepo.withTx(tx).create({ workosOrgId, name })` → local UUID (mirror per
   sticky #16).
3. `membershipRepo.withTx(tx).create({ userId, orgId, role: 'owner' })`.
4. `safeAudit` `org.created` + `membership.created`.
5. On commit, emit `org.created` to EventBridge.

Awaits stay sequential — Drizzle's tx wraps one Postgres connection (sticky #15).

## Security

- **Single-membership guard (FR5)** — reject creation if the actor already has a
  membership; defence against multi-org at v0.1.
- **Tenant isolation from birth** — the new org's rows are scoped the moment
  they exist; `tenant-isolation`'s factory governs every subsequent access.
- **Rate-limited** — reuse the slice-1 limiter to prevent org-spam.
- **Audit** via `safeAudit`/`recordAuditEvent` only; `org.created` +
  `membership.created` added to `AuditEventTypeSchema`.

## Observability

- **Metrics:** `org.created.count`, `org.create.latency_ms`,
  `org.create.failures`, `org.provision.room_handoff{ok,retry}`.
- **Alert:** `org.create.failures` spike; `room_handoff` retries climbing
  (provisioning subscriber stuck).
- **Logs:** `userId, workosOrgId, orgId, latencyMs`.

## Key trade-offs

- **Pull the mechanism forward, leave the UX in slice 9.** Unblocks Phase 1
  (rooms/tenant-isolation need an org) without front-loading the whole wizard.
  Slice 9 becomes a UX wrapper, not an owner — cleaner separation.
- **Event-driven room provisioning over a direct call.** Keeps the dependency
  one-directional and lets `room-and-folders` own its own provisioning logic.
- **WorkOS-org-created-here over mirror-only.** Self-contained flow; cost is the
  external-call-then-tx ordering nuance (open question).

## Open questions

_All resolved as the slice landed — see
[`docs/slices/org-provisioning.md`](../../../../docs/slices/org-provisioning.md)
§Resolved design questions for the full rationale._

- ~~WorkOS-create-then-DB-tx ordering: compensate or accept a logged
  orphan?~~ **RESOLVED (T-002): compensate.** WorkOS org created pre-tx;
  a tx failure best-effort-deletes it. A failed delete is logged +
  metered (`org.create.compensation_failed`) for reconciliation. See
  `createOrg.ts`.
- ~~Emit reliability of `org.created`?~~ **RESOLVED (T-005): post-commit,
  best-effort, idempotent consumer.** Emitted after commit; a publish
  failure is logged + metered (`org.provision.room_handoff_failed`), not
  thrown. EventBridge at-least-once is safe because the consumer keys
  idempotency on `org_id` (NFR2). See `eventBridgeOrgEventPublisher.ts`.
- ~~Should `POST /orgs` accept inline invites?~~ **RESOLVED: org-only.**
  Invites compose via `access-control` + the slice-9 wizard.

## Sign-off

- [x] Bradley reviewed
- [x] Tasks phase unblocked
