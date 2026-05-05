# Tasks — ai-data-room / auth-and-orgs

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-04-21

Tasks are written for a Claude Code agent to execute inside the target
repo (`Evans-Software-Solutions-Limited/ai-data-room`, scaffolded from
`sst-monorepo-template`). Each task is atomic, has a clear DoD, and lists
test requirements. Hand them off one at a time unless the "Dependencies"
block at the bottom says they can run in parallel.

## Conventions

- ID: `T-###`
- Status: `[ ]` todo / `[~]` in progress / `[x]` done
- Every task lists: scope, files likely touched, DoD, tests required.
- Layered architecture convention (matches FDP):
  `microservices/core/{domain,application,infrastructure,handlers}`.
- Bun workspaces + Turborepo. `bun run test` (Vitest), not `bun test`.
- Playwright for e2e (matches FDP).

---

## T-001 — Scaffold `ai-data-room` repo from `sst-monorepo-template`

Status: `[x]` (2026-04-22, commit `9ba0733`)
**Scope:** Create `Evans-Software-Solutions-Limited/ai-data-room` by
copying `sst-monorepo-template`. Update `package.json` name, README,
sst.config.ts app name. Add CODEOWNERS + LICENSE. Configure CI
(release-please, Playwright, Vitest — mirror FDP's `.github/workflows/`).
**Files (likely):** `package.json`, `README.md`, `sst.config.ts`,
`.github/workflows/*.yml`, `CODEOWNERS`, `LICENSE`.
**Definition of done:**

- Repo exists in GitHub under `Evans-Software-Solutions-Limited`. ✅
- `bun install && bun run typecheck` passes. ⏳ Bradley to verify locally.
- CI runs on PR open and pushes to main. ⏳ Inherited from template; not
  yet exercised against the new repo.
  **Tests required:** None yet (scaffold-only).
  **Notes:** PlanetScale Postgres confirmed (matches FDP + ADR-002).

---

## T-002 — Provision WorkOS + secrets

Status: `[x]` (closed 2026-04-22 — `/_health/workos` returned 200 with all four secrets present on the `dev` stage at the deployed API URL)
**Scope:** Create WorkOS project for ai-data-room. Add API key,
client ID, webhook secret, cookie signing key to AWS Secrets Manager
via SST. Pattern matches FDP's `infra/secrets.ts`.
**Files (likely):** `infra/secrets.ts`, `infra/api.ts`, `sst.config.ts`,
`microservices/core/src/handlers/auth/healthWorkosGetHandler.ts`.
**Definition of done:**

- `dev` and `staging` stages each reference WorkOS secrets. ⏳ See
  Bradley actions.
- Secret names follow FDP convention. ✅ snake_case + SCREAMING_SNAKE.
- **Only secrets this slice uses** are declared in `infra/secrets.ts`.
  Pre-declaring future-slice secrets blocks every stage's deploy with
  `SecretMissingError` (SST resolves every `new sst.Secret(...)` at
  deploy time). Deferred secrets stay as comments in the ledger. ✅
- A simple handler `GET /_health/workos` returns 200 when creds are
  wired correctly (internal-only, removed in T-015 before prod). ✅
  handler in `microservices/core/src/handlers/auth/healthWorkosGetHandler.ts`.
  **Tests required:** Integration test hitting `/_health/workos` against
  the dev stack. ⏳ Unit tests landed (`__tests__/healthWorkosGetHandler.test.ts`);
  dev-stack integration via `scripts/check-workos-health.ts <url>`.

**Branch:** `feat/auth-and-orgs-T-002-workos-secrets` (open PR into
`main`). **Never commit directly to `main`.**

**Bradley actions to close T-002:**

1. Sign up to WorkOS, create the `ai-data-room` project for each stage
   (`dev`, `staging`, `production`).
2. From each stage's WorkOS dashboard, copy the API key, client ID,
   and webhook secret. Generate a 32+ char random string for the
   cookie password with `openssl rand -base64 48` (WorkOS cannot
   generate this — it's the symmetric key AuthKit uses to seal the
   session cookie; rotate per stage, non-recoverable once set).
3. From the repo root, for each stage:
   ```
   bun sst secret set WORKOS_CLIENT_ID <value> --stage <stage>
   bun sst secret set WORKOS_API_KEY <value> --stage <stage>
   bun sst secret set WORKOS_WEBHOOK_SECRET <value> --stage <stage>
   bun sst secret set WORKOS_COOKIE_PASSWORD <value> --stage <stage>
   ```
4. Before deploy: `bun run typecheck && bun run prettier:check`
   (catches infra + workspace regressions). Then `bun sst diff
--stage dev` — our infra typecheck runs against an ambient shim
   so `sst.aws.<Component>` is `any`; `sst diff` is the guard for
   component-name typos (learned the hard way when `sst.aws.KmsKey`
   slipped to deploy, 2026-04-22).
5. `bun sst deploy --stage dev`, then run
   `bun run scripts/check-workos-health.ts <api-url>` against the
   `api-core` URL the deploy prints. 200 = T-002 closed.

---

## T-003 — Provision Postgres + drizzle setup

Status: `[x]` — closed 2026-04-23 on PR #2
**Scope:** Stand up Postgres (PlanetScale or RDS — match FDP). Wire
drizzle-kit, connection pool via `DATABASE_URL` secret. Create empty
migrations directory and a CI check that `drizzle-kit generate` emits
no drift.
**Files (likely):** `packages/db/`, `infra/db.ts`, `sst.config.ts`,
`drizzle.config.ts`.
**Definition of done:**

- `bun run db:migrate` applies to dev and staging.
- `bun run db:studio` works locally.
- CI fails if schema and migrations are out of sync.
  **Tests required:** Smoke test that a trivial migration applies and
  rolls back cleanly.

**Outcome notes (2026-04-23):**

- Adopted PlanetScale Postgres per ADR-002. Connection string sourced
  from `Resource.PLANETSCALE_DATABASE_URL.value`; secret declared in
  `infra/secrets.ts` and linked to the `core-api` Lambda in
  `infra/api.ts`. Same env var feeds `drizzle.config.ts` for migrate /
  introspect / studio (all three CLI subcommands use it).
- T-005 carve-out: T-003 absorbs the first auth migration (the schema
  was already authored in T-001 for downstream design work). T-005
  retains the augment-with-`citext`, partial-unique-index, manual
  reverse, and per-repo integration-test deliverables.
- Drift check is a tiny shell script (`scripts/db-drift-check.sh`)
  exposed as `bun run db:check` and gated in CI under the `db` paths
  filter — only fires on PRs that touch `packages/db/**`. Exits 1 on
  drift with a one-liner remediation message.
- Smoke test runs against a Postgres 16 testcontainer
  (`@testcontainers/postgresql`) — applies `migrations/0000_*`,
  asserts the 6 tables + 8 enums exist, drops `public` schema, re-
  applies, asserts tables again. Lives at
  `packages/db/src/__tests__/integration/migrate.test.ts` under a
  separate vitest config so unit-test cycles stay docker-free.
- `bun run db:migrate` against dev/staging is gated on Bradley
  provisioning the PlanetScale database + setting
  `PLANETSCALE_DATABASE_URL` per stage — captured in the PR description
  as a post-merge action.

---

## T-004 — Domain layer: types + zod schemas

Status: `[x]` — closed 2026-04-28 on PR #4
**Scope:** Define domain types and zod schemas (no DB, no IO): `Org`,
`User`, `OrgMembership`, `ExternalAccessGrant`, `Invitation`,
`AuditEvent`, `Role`, `LifecycleState`, `AuditEventType` (enum of the
21 values from FR24).
**Files (likely):**
`microservices/core/domain/{org,user,invitation,audit}.ts`,
`packages/api-utils/schemas/auth-orgs.ts`.
**Definition of done:**

- All types exported from a single barrel per aggregate.
- `AuditEventType` enum is exhaustive vs. FR24 (lint rule or test).
  **Tests required:** Vitest unit tests for schema parsing (happy path +
  one failure case per schema).

---

## T-005 — Drizzle migrations: six tables

Status: `[x]` — closed 2026-04-28 on PR #5
**Scope:** Write migrations for `organizations`, `users`,
`org_memberships`, `external_access_grants`, `invitations`,
`audit_events` per §Data model. Include indexes. Include the unique
partial index for single-owner-per-org.
**Files (likely):** `packages/db/schema/*.ts`,
`packages/db/migrations/*.sql`.
**Definition of done:**

- Applying migrations produces the schema described in design.md.
- Reverse migrations tested manually.
  **Tests required:** Integration test that spins up a test DB,
  applies migrations, inserts a happy-path row per table, and queries it.

---

## T-006 — Infrastructure layer: WorkOS client wrapper

Status: `[x]` — closed 2026-04-28 on PR #6
**Scope:** Thin wrapper over `@workos-inc/node` exposing the
operations we actually need: `userManagement.getAuthorizationUrl`,
`authenticateWithCode`, `getUser`, `deleteUser`, `createInvitation`,
`revokeInvitation`, `sendPasswordResetEmail`, `revokeSession`.
Mirror the pattern FDP uses. Webhook signature verification helper.
**Files (likely):**
`microservices/core/infrastructure/workos/{client,webhook}.ts`.
**Definition of done:**

- Wrapper is side-effect free at module load.
- Webhook signature verification rejects tampered payloads.
  **Tests required:** Vitest unit tests using a mocked `@workos-inc/node`

* real signature verification against a known-good fixture.

---

## T-007 — Infrastructure layer: repository for each aggregate

Status: `[x]` — closed 2026-04-29 on PR #7
**Scope:** Drizzle-backed repositories: `OrgRepo`, `UserRepo`,
`MembershipRepo`, `ExternalGrantRepo`, `InvitationRepo`, `AuditRepo`.
Each exposes only the queries the application layer needs. No business
logic.
**Files (likely):** `microservices/core/infrastructure/db/*.ts`.
**Definition of done:**

- Each repo covered by an integration test against a transactional
  test DB.
- No SQL string interpolation — drizzle query builders or parameterised
  SQL only.
  **Tests required:** One integration test per repo method, committed
  and green.

---

## T-008 — Application layer: signup + callback flow

Status: `[x]` — closed 2026-04-30 on PR #9
**Scope:** `handleSignup`, `handleLoginCallback`. On callback:
(1) exchange WorkOS code, (2) find-or-create `users` row, (3) if
signup-kind, create `organizations` + owner `org_memberships` row,
(4) write audit event (`signup` / `login_success`), (5) set session
cookie. Enforce MFA-present before session issuance (reject if WorkOS
returns a user without MFA for any role).
**Files (likely):** `microservices/core/application/signup.ts`,
`microservices/core/application/login.ts`.
**Definition of done:**

- US1 + US4 acceptance criteria reachable via the application layer
  (handlers not yet wired).
  **Tests required:** Vitest unit tests with mocked repos + WorkOS
  client. Cover: fresh signup, returning login, MFA-missing rejection,
  suspended-user rejection.

---

## T-009 — Application layer: invitations

Status: `[~]` (in flight — branch `feat/auth-and-orgs-T-009-invitations`)
**Scope:** `createInvitation` (internal + external variants),
`listInvitations`, `revokeInvitation`, `acceptInvitation`. Enforce
FR6–FR10. Only owner/admin can invite; only owner can invite an admin;
external invites must include an `opportunity_slug`. Writes audit
events for every mutation.
**Files (likely):** `microservices/core/application/invitations.ts`.
**Definition of done:** Application-level acceptance for US2 + US3.
**Tests required:** Unit tests covering each authorization branch +
expiry + revoke-after-accept rejection.

---

## T-010 — Application layer: MFA enrolment hook + recovery-code-used audit

Status: `[~]` (in flight — branch `feat/auth-and-orgs-T-010-mfa-enrolment`)

**Scope (trimmed by [ADR-003](../../../adr/003-recovery-codes-delegated-to-authkit.md)):**
WorkOS AuthKit handles every part of recovery-codes UX (view +
download at enrolment); we never see plaintext codes. Our job:

- On `authentication.mfa_enrolled` webhook: mirror `mfa_enrolled_at`
  on the local `users` row + audit `mfa_enrolled`.
- On `authentication.recovery_code_used` webhook: audit
  `recovery_code_used` (no metadata identifying which code, since
  we don't see them).
  The `getRecoveryCodesForDownload` method that the original spec
  referenced is **not** implemented — see ADR-003 for rationale.

**Files (likely):** `microservices/core/src/application/mfa.ts`.

**Definition of done:** FR17(a) and FR17(b) delivered by AuthKit's
hosted enrolment UI; FR17(c) regenerate captured as a deferred
follow-up in ADR-003. AC-US9's "use is recorded in the audit trail"
half is reachable at the application layer; the "view once + download"
half is verified at the web-shell layer (T-017) by a Playwright
assertion that the AuthKit redirect surfaces those affordances.

**Tests required:** Unit tests for both webhook handlers — happy path
(mirror + audit), missing-user idempotency (audit failure + return
null, not throw, so webhook redelivery is safe).

---

## T-011 — Application layer: password reset

Status: `[~]` (in flight — branch `feat/auth-and-orgs-T-011-password-reset`)
**Scope:** `requestPasswordReset` delegates to WorkOS's password-reset
email flow. On `password_reset_completed` webhook, invalidate all
sessions for the user via WorkOS `session.revoke`, write audit event.
**Files (likely):** `microservices/core/application/password-reset.ts`.
**Definition of done:** US5 acceptance reachable at application layer.
**Tests required:** Unit tests for both events.

---

## T-012 — Application layer: suspension lifecycle

Status: `[x]` — closed 2026-05-01 on PR #10
**Scope:** `suspendUser`, `unsuspendUser`. Enforce FR21–FR23 incl.
sole-owner-cannot-be-suspended and actor-cannot-suspend-self.
Suspension path: (1) flip `lifecycle_state` in a transaction, (2) call
WorkOS `session.revoke` for all active sessions, (3) bust our session
cache, (4) write audit event. Un-suspension reverses (1) + (4).
**Files (likely):** `microservices/core/application/suspension.ts`.
**Definition of done:** AC-US11 reachable at application layer.
**Tests required:** Unit tests for all authorization branches + a
timing test asserting session-revocation call happens before the
handler returns.

---

## T-013 — Application layer: audit event writer

Status: `[x]` — closed 2026-04-29 on PR #8
**Scope:** Single `recordAuditEvent(event)` function. Enforces
canonical shape (design.md §Audit event canonical shape). Strips any
field listed in NFR8. Writes to `audit_events` repo.
**Files (likely):** `microservices/core/application/audit.ts`.
**Definition of done:** All 21 event types from FR24 produced by some
callsite in the codebase (verified by a grep-style test).
**Tests required:** Unit test that the writer rejects events missing
required fields + strips forbidden fields.

---

## T-014 — Handlers: HTTP routes

Status: `[~]` (in flight — branch
`feat/auth-and-orgs-T-014a-public-auth-routes`, public routes
only; protected routes deferred to T-014b alongside T-015 session
middleware)
**Scope:** Wire the application layer into API Gateway handlers per
§Interfaces. Public routes (`/auth/*`, `/webhooks/workos`) unauth'd;
everything else behind session middleware. CSRF double-submit on
mutating routes. Rate limiting per NFR4 at API Gateway + per-handler
backoff.
**Files (likely):** `microservices/core/handlers/*.ts`,
`microservices/core/middleware/{session,csrf,rate-limit}.ts`,
`infra/api.ts`.
**Definition of done:** All routes listed in design.md respond with
the shapes in the schemas from T-004.
**Tests required:** Integration tests per route using the local SST
dev stack.

---

## T-015 — Session middleware + `/me`

Status: `[ ]`
**Scope:** Middleware that validates the session cookie with WorkOS
(LRU cache TTL 60s), hydrates `req.session = { userId, orgId, role,
opportunityScopes[] }`. Remove the T-002 `/_health/workos` handler.
Implement `GET /me` per FR14.
**Files (likely):** `microservices/core/middleware/session.ts`,
`microservices/core/handlers/me.ts`.
**Definition of done:** AC-US7 passes in Playwright (browser restart
within inactivity window stays logged in).
**Tests required:** Integration + Playwright.

---

## T-016 — WorkOS webhook handler

Status: `[~]` (in flight — branch `feat/auth-and-orgs-T-016-webhook-routing`)
**Scope:** `POST /webhooks/workos`. Verify signature (T-006). Route
each event type to the appropriate application function (`user.created`
→ mirror user, `authentication.*` → audit writer, `session.revoked`
→ cache bust, etc.). Idempotent — re-delivery of a webhook produces
no duplicate audit rows.
**Files (likely):** `microservices/core/handlers/webhooks/workos.ts`.
**Definition of done:** Replaying a webhook 3× yields exactly one
audit row and one state change.
**Tests required:** Integration tests with fixture payloads (valid,
tampered, duplicate, unknown-type).

---

## T-017 — Minimal web shell: login, signup, MFA enrolment, logout, `/me` page

Status: `[ ]`
**Scope:** Next.js pages that delegate to WorkOS AuthKit for all auth
UI. Our `/app` page shows the `/me` payload and a logout button, plus
the recovery-codes download on MFA enrolment (T-010). Deliberately
ugly — polish lives in `onboarding-flow`.
**Files (likely):** `packages/web/app/{login,signup,logout,app,mfa}/page.tsx`.
**Definition of done:** Every AC-US\* reachable end-to-end in a browser.
**Tests required:** Playwright coverage for AC-US1 through AC-US11.

---

## T-018 — Observability: logs, metrics, alerts

Status: `[ ]`
**Scope:** Structured logging (pino). CloudWatch EMF metrics per
design.md §Observability. X-Ray enabled. Terraform/SST alarms created
for the five alert rules listed.
**Files (likely):** `infra/observability.ts`,
`microservices/core/infrastructure/logger.ts`.
**Definition of done:** A staging load test produces the expected
metrics; synthetic alert fires correctly.
**Tests required:** Smoke test asserting each metric name is emitted
at least once in a representative run.

---

## T-019 — GDPR hard-delete path

Status: `[~]` (in flight — branch `feat/auth-and-orgs-T-019-gdpr-delete`)
**Scope:** On `user.deleted` webhook: (1) scrub PII from `users` row,
(2) set `lifecycle_state='deleted'`, (3) preserve `workos_user_id` and
all `audit_events.target_user_id` references, (4) audit event for the
deletion itself. Document the support-only path in `ops/runbooks/`.
**Files (likely):** `microservices/core/application/deletion.ts`,
`ops/runbooks/gdpr-delete.md`.
**Definition of done:** NFR9 verified by a test that deletes a user
and asserts PII is gone but audit joins still resolve.
**Tests required:** Integration test.

---

## T-020 — Rate limiting + NFR hardening pass

Status: `[ ]`
**Scope:** Implement NFR4 at API Gateway (IP-based) and handler layer
(email-based). Verify NFR2, NFR3, NFR5, NFR7, NFR8 via a checklist
test file. Document the matrix in `docs/security.md`.
**Files (likely):** `infra/api.ts`, `docs/security.md`,
`tests/security/nfr-matrix.spec.ts`.
**Definition of done:** `nfr-matrix.spec.ts` green in CI.
**Tests required:** That file, covering each NFR.

---

## T-021 — Playwright acceptance suite

Status: `[ ]`
**Scope:** One Playwright test per AC (`AC-US1` through `AC-US11`).
Runs against a dedicated e2e stage. Tagged so they can run on PR +
nightly.
**Files (likely):** `tests/e2e/auth-and-orgs/*.spec.ts`.
**Definition of done:** All 11 specs green on CI against the e2e stage.
**Tests required:** N/A (this _is_ the test layer).

---

## T-022 — Slice sign-off checklist

Status: `[ ]`
**Scope:** Final pass: verify every FR, NFR, and AC has at least one
corresponding test. Run the `engineering:deploy-checklist` skill.
Tag `v0.1.0-auth-and-orgs` when merged to `main`.
**Files (likely):** `docs/slices/auth-and-orgs.md` (requirement ↔ test
matrix).
**Definition of done:** Traceability matrix committed; release tagged.
**Tests required:** N/A (review gate).

---

## Dependencies

```
T-001 ──► T-002 ──► T-003 ──► T-005 ──► T-007 ─┐
                        │                      │
                        └──► T-004 ────────────┤
                                               ▼
                               T-006 ──► T-008 ──► T-014 ──► T-015 ──► T-017
                                       └► T-009 ──┤
                                       └► T-010 ──┤
                                       └► T-011 ──┤
                                       └► T-012 ──┤
                                       └► T-013 ──┤
                                       └► T-016 ──┘
                               T-018, T-019, T-020 run in parallel after T-015
                               T-021 after T-017
                               T-022 last
```

**Parallelisable after T-007:**

- T-008 / T-009 / T-010 / T-011 / T-012 / T-013 / T-016 all depend on
  T-006 + T-007 but not on each other. Hand them to parallel Claude
  Code agents.
- T-018 / T-019 / T-020 can run in parallel with T-017.

## Acceptance for the slice

Slice is "done" when:

1. All AC-US\* in `requirements.md` pass in Playwright on the e2e stage.
2. T-022 traceability matrix is merged.
3. `v0.1.0-auth-and-orgs` is tagged on `main`.
