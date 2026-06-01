# Tasks — ai-data-room / org-provisioning

**Status:** signed off (Bradley, 2026-05-31) — ready to execute
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-31

Assumes `auth-and-orgs` merged (tagged `v0.1.0-auth-and-orgs`). Executes in
`microservices/core` (`application/orgs/*`), reusing slice-1 repos + the WorkOS
client wrapper. Lands **before** `tenant-isolation` and `room-and-folders`.
This slice also carries the **role-vocabulary migration** (T-000, per
[ADR-012](../../../adr/012-role-vocabulary.md) / RB-7) — it's the first build
target and already touches memberships/roles, so the rename lands here before
any later slice builds role-tier logic. Conventions: same as
`auth-and-orgs/tasks.md`; 90% coverage gate.

---

## T-000 — Role-vocabulary migration (admin→editor, internal→viewer)

Status: `[x]`
**Scope:** Rename the shipped role enum end to end, per ADR-012. **The canonical
source of the role union is the zod `RoleSchema` / `InvitationRoleSchema` in
`packages/api-utils/src/schemas/auth-orgs.ts` — every domain type, repo, and
guard derives from it, so it must move first or the Drizzle enum and the TS type
disagree.** DB: migrate `org_memberships.role` and `invitations.role` enum values
`admin`→`editor`, `internal`→`viewer`. Use Postgres `ALTER TYPE … RENAME VALUE`
(clean, fully reversible — down is the reverse rename). drizzle-kit cannot emit
`RENAME VALUE` (it diffs enum changes as drop/recreate), so this is a
**hand-authored** migration paired with a `.down.sql` outside the read folder
(sticky #8), with a comment explaining why. Code: update the zod schemas above,
the Drizzle schema, repos, `authorizeOrgAccess` + role allowlists
(`OWNER_ADMIN`), the `/me` inline role union, the invitation role guards +
handler body schema, audit metadata literals, and all fixtures/tests. **No WorkOS
role-metadata update is required — role is stored locally only; the WorkOS client
carries no role metadata (verified 2026-05-31). If WorkOS RBAC is adopted later
that is its own task.** **Leave the `kind` (`internal`/`external`) category and
`ROLES[x].internal` flag untouched** — those are the category, not the role.
**Files (likely):**
`packages/api-utils/src/schemas/auth-orgs.ts` (canonical `RoleSchema` +
`InvitationRoleSchema`),
`packages/db/src/schema/auth.ts` (`orgRole`, `invitationRole` pgEnums),
`packages/db/migrations/*` (+ paired `.down.sql`),
`microservices/core/src/infrastructure/db/membershipRepo.ts`,
`microservices/core/src/application/auth/_shared/orgAccess.ts` (`OWNER_ADMIN`),
`microservices/core/src/application/auth/user/getUserHandler.ts` (inline 4-tuple),
`microservices/core/src/application/invitations.ts` (role guards + audit meta),
`microservices/core/src/application/auth/invitations/postInvitationsHandler.ts`
(`t.Union([t.Literal("admin"), t.Literal("internal")])` body schema),
test fixtures across `application/__tests__/*` + `auth/**/__tests__/*`.
**DoD:** No `admin`/`internal` _role_ token remains in code or DB; `/me` returns
`owner|editor|viewer|external`; slice-1 suite green; ADR-012 → `accepted`. Note:
`migrate.integration.test.ts` asserts enum _names_ (`pg_type.typname`) only, so a
value rename is invisible to it and `EXPECTED_ENUMS` needs **no** change — instead
**add a value-level assertion** (`pg_enum.enumlabel` for `org_role` /
`invitation_role`) so the rename is actually covered.
**Tests required:** Migration integration test (up + down) **with the new
value-level enum-label assertion**; regression that a former-`admin` member
resolves as `editor` and a former-`internal` as `viewer`; guard/authorize tests
on the new names.
**Blocks:** every later task that creates or reads a membership role.

---

## T-001 — Domain + schemas: create-org DTO + org.created event

Status: `[~]`
**Scope:** `CreateOrgInput` zod schema (name 1–80); `org.created` event payload
type; add `org.created` + `membership.created` to `AuditEventTypeSchema`. **That
enum lives in `packages/api-utils/src/schemas/auth-orgs.ts` (not
`application/audit.ts`, which only imports `AuditEventSchema`).** Its
exhaustiveness is locked by a count assertion in
`packages/api-utils/src/schemas/__tests__/auth-orgs.test.ts` — going from 21 to
23 events **will fail that test** unless its count + per-name presence checks are
updated in the same change.
**Files (likely):** `microservices/core/src/domain/org.ts`,
`packages/api-utils/src/schemas/org.ts` (new — `CreateOrgInput`),
`packages/api-utils/src/schemas/auth-orgs.ts` (`AuditEventTypeSchema` +2),
`packages/api-utils/src/schemas/__tests__/auth-orgs.test.ts` (count 21→23).
**DoD:** Schemas + event type exported; audit enum extended; the auth-orgs
exhaustiveness test updated and green.
**Tests required:** Unit — schema happy + failure; the auth-orgs count/presence
test asserts the two new events.

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
