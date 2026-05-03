# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-03 by Claude Code, mid-flight on the
multi-write transaction wrapper refactor. Branch
`chore/repos-accept-pgtransaction` is open and awaiting review.
T-010 (MFA enrolment) merged earlier today as PR #13.

## Currently in flight

**Chore: repos accept `Db | PgTransaction` + signup wraps in a
transaction.** The "multi-write transaction wrapping" follow-up
that's been on the backlog since T-008. Unblocks T-009
(invitations) and T-019 (GDPR delete) — both of which need atomic
multi-write to land cleanly.

What changed:

- `packages/db/src/index.ts` — exports `Tx` (Drizzle's
  postgres-js transaction handle) and `DbOrTx = Db | Tx`.
- All 6 T-007 repos in `microservices/core/src/infrastructure/db/`
  now accept `DbOrTx` in their constructor and expose
  `withTx(tx: Tx)` as a factory that returns a tx-bound instance.
- `microservices/core/src/application/signup.ts` wraps the
  user / org / membership creates in `db.transaction(...)`. Audit
  stays outside the transaction (matches `safeAudit`'s
  rollback-isolation contract). The "KNOWN FOLLOW-UP" orphan-org
  comment is gone.
- `microservices/core/test/integration/db/userRepo.integration.test.ts`
  adds a `withTx()` describe block — one test asserts commit, one
  asserts rollback against a real Postgres tx. Other repos lean on
  this + their own unit typing rather than duplicating.
- `packages/db/test/integration/setup.ts` exposes a new
  `getTestDb()` helper to consolidate `drizzle(getTestPool(), {
schema })` constructions across integration tests.
- `microservices/core/src/application/__tests__/signup.test.ts`
  gets two new tests: "writes happen inside `db.transaction`" and
  "no success audit on rollback".

Local guard set green: `typecheck` (force) + `test:unit` (force,
107/107 incl. signup at 100/100/100/100) + `lint` + `prettier:check`.
Awaiting CI + Cursor Bugbot + Brad's review.

### Pattern picked: `withTx(tx)` factory on each repo

The clean alternatives were:

- **(A) Method-level `tx?` parameter** — every repo method takes
  an optional tx. Cleanest at the call site (`repo.create(input,
tx)`), but adds a parameter to every method on every repo and
  every test mock.
- **(B) Constructor-only widening + import the concrete repo
  classes inside the txn callback** — `new UserRepo(tx)` directly.
  Couples application code to concrete classes (DI breaks).
- **(C) `withTx(tx)` factory ✅ chosen** — repos accept `DbOrTx`
  in the constructor, and a one-line factory returns a tx-bound
  clone. Three lines per repo, zero call-site noise inside the
  callback (`userRepo.withTx(tx).create(...)`), DI-clean. Same
  contract every repo exposes.

FDP's pattern (`TenantScopedConnection.transaction(cb)` opening
the tx _inside_ the repo) doesn't fit because Drizzle's
`db.transaction()` lives on the client and we want the
application layer — not the repo — to own the txn boundary.

### Departures from the brief after the simplify review

1. **No `BaseRepo` extraction.** Six identical 3-line `withTx`
   methods could become a single base class with
   `this.constructor as new (db: DbOrTx) => this`, but that
   incantation costs more than the duplication saves. Keep inline.
2. **Dropped redundant call-order assertion** in the new signup
   test. The mock's structural shape (`db.transaction(cb)` calls
   `cb(TX_SENTINEL)` synchronously) already enforces "writes
   happen inside the transaction"; the
   `invocationCallOrder`-based assertion defended nothing extra.
3. **Single integration test for `withTx`.** All 6 repos have the
   same 3-line `withTx` body; one integration test on `UserRepo`
   exercising commit + rollback against a real Postgres tx is
   enough proof. The other 5 repos lean on their unit typing.
4. **`getTestDb()` helper extracted** because three callsites for
   `drizzle(getTestPool(), { schema })` was the threshold to
   consolidate.
5. **AuditRepo's `withTx` doc trimmed.** The "audit usually stays
   outside the caller's transaction" rationale lives in
   `_audit-context.ts`'s `safeAudit` doc, not on the repo.

### Deliberately not done in this PR (reviewer flagged, deferred)

- **Renaming `Db` → `DbClient` / `DbSession`** — would make
  `Db | Tx` more self-documenting at the type level. Optional
  rename; defer.
- **Existing carryovers:** shared `revokeAllActiveSessions`
  helper, `lookupOrAuditFailureForWebhook` helper (3 webhook
  callers), `AUDIT_REASONS` constants, shared test fixtures,
  `AuthFlowError<TReason>` generic — all still deferred.

## Where we are in slice 1 (auth-and-orgs)

| Task  | Status                     | Notes                                                                        |
| ----- | -------------------------- | ---------------------------------------------------------------------------- |
| T-001 | ✅                         | Repo scaffold.                                                               |
| T-002 | ✅                         | WorkOS + secrets wiring (PR #1).                                             |
| T-003 | ✅                         | Postgres + Drizzle setup (PR #3).                                            |
| T-004 | ✅                         | Domain types + zod schemas (PR #4).                                          |
| T-005 | ✅                         | Postgres-specific DDL augments (PR #5).                                      |
| T-006 | ✅                         | WorkOS client wrapper + webhook verifier (PR #6).                            |
| T-007 | ✅                         | Typed Drizzle repositories (PR #7).                                          |
| T-013 | ✅                         | Application-layer audit event writer (PR #8).                                |
| T-008 | ✅                         | Signup + login callback flows (PR #9).                                       |
| T-012 | ✅                         | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).                 |
| T-011 | ✅                         | Password reset (PR #12).                                                     |
| T-010 | ✅                         | MFA enrolment + recovery-code-used audit (PR #13, scope trimmed by ADR-003). |
| –     | 🟡 **in flight** (this PR) | Chore: repos accept `Db \| PgTransaction` + signup wraps multi-write.        |
| T-009 | ⏳                         | Application: invitations (now unblocked by this PR).                         |
| T-014 | ⏳                         | Handlers: HTTP routes (depends on the application-layer fan-out below).      |
| T-015 | ⏳                         | Session middleware + `/me` (depends on T-014).                               |
| T-016 | ⏳                         | WorkOS webhook handler routing — best landed AFTER T-008–T-012 / T-019.      |
| T-017 | ⏳                         | Minimal web shell (login / signup / MFA / `/me`).                            |
| T-018 | ⏳                         | Observability (logs / metrics / alerts).                                     |
| T-019 | ⏳                         | GDPR hard-delete.                                                            |
| T-020 | ⏳                         | Rate limiting + NFR hardening.                                               |
| T-021 | ⏳                         | Playwright acceptance suite.                                                 |
| T-022 | ⏳                         | Slice sign-off + traceability matrix + tag.                                  |

## Recommended next pick after this chore PR merges

With the txn wrapper landed, the application-layer fan-out can
finish:

1. **T-009 (invitations)** — the biggest remaining application
   task. Multi-write (invitations row + sometimes
   external_access_grants for external invites). The new
   `withTx(tx)` factory + `db.transaction()` pattern from this PR
   is the template; copy the signup.ts shape.
2. **T-019 (GDPR hard-delete)** — also multi-write (PII scrub on
   `users` row + audit). Smaller than T-009; same template.
3. **T-016 (webhook routing)** — best landed AFTER all the
   application functions exist, since it routes events to all of
   them. Validates the `mfa_enrolled` / `recovery_code_used` /
   `password_reset.succeeded` handlers.

### Faster alternative if Brad wants a small win first

- Extract `revokeAllActiveSessions` helper (suspension +
  password-reset); ~50 LOC + test updates.
- Extract `AUDIT_REASONS` constants for the
  `"user_not_found"` / `"revoke_failed"` / `"delegate_error"`
  string literals across password-reset.ts and mfa.ts.
- Add `listAuthFactors` to the WorkOS wrapper + swap the
  `isMfaPresent` default in signup/login (per sticky #15).

## Pending follow-ups (not blocking, but worth doing soon)

1. **Multi-write transaction wrapping** — `application/signup.ts`
   today does three writes (user / org / membership) outside any
   transaction. If membership-insert fails, we orphan an org. The
   T-007 repos accept a `Db`; they need to also accept a
   `PgTransaction` so callers can wrap sequences in
   `db.transaction(async (tx) => { ... })`. Touches all six repos
   plus their integration tests. Bounded scope (~half a day).
   Prerequisite for T-009 (invitations) and T-019 (hard-delete) to
   land cleanly.
2. **`AuthFlowError` generic** — `SignupError`, `LoginError`,
   `SuspensionError`, `PasswordResetRequestError`,
   `PasswordResetCompletionError` are nearly identical class shells.
   Could extract a generic `AuthFlowError<R extends string>` to
   `application/_errors.ts`. Touches five files for ~15 LOC savings
   — low priority but clean if a future task is in the
   neighbourhood.
3. **`revokeAllActiveSessions` helper** — see "Deliberately not
   done in this PR" above.
4. **Shared application-test fixtures** — see same.

## Sticky knowledge — kept across handoffs

1. **Drizzle 0.30+ moved bookkeeping into a `drizzle` schema.**
   Reset logic must drop both `public` and `drizzle` (or truncate
   `drizzle.__drizzle_migrations`).
2. **SST component-name typos only surface at deploy time**
   (`sst.aws.*` is `any` in the ambient shim). Always
   `bun sst diff --stage <dev>` before pushing infra changes.
3. **Don't pre-declare future-slice secrets.** SST refuses to
   deploy if any declared secret is unset.
4. **Local docker-compose is `ai-data-room-test-db`-prefixed** to
   avoid colliding with FDP's compose stack.
5. **`bun run test`, not `bun test`.** Bun's built-in runner
   doesn't support our Vitest setup. Note `bun run test` requires
   `sst shell` (AWS creds); `bunx vitest run <pattern>` is the
   no-creds local fast path.
6. **`.claude/` is gitignored + prettier-ignored.**
7. **Migration naming**: drizzle-kit emits
   `0001_<random_nouns>.sql`; we rename to `0001_<intent>.sql`
   and update the `tag` in `meta/_journal.json`.
8. **Hand-edited migrations** — pair every hand-touched `*.sql`
   with a `*.down.sql` outside the migrations folder drizzle reads.
9. **WorkOS SDK names** — `userManagement.sendInvitation` (not
   `createInvitation`), `userManagement.createPasswordReset` (no
   `sendPasswordResetEmail` method). The wrapper at
   `infrastructure/workos/client.ts` bridges them.
10. **WorkOS webhooks need a synthetic clientId** —
    `new WorkOS({})` throws; PKCE-mode
    `new WorkOS({ clientId: ... })` is the workaround for
    signature-verification-only paths.
11. **Repos use `firstOrNull` for "select-one or null" and
    `firstOrThrow` for "update-must-find-row"** —
    `_helpers.ts` is the single home.
12. **AuditRepo cursor is composite `(occurredAt, id) < (cursor)`**
    — the id half is load-bearing for events sharing a millisecond.
13. **All audit writes go through
    `application/audit.ts#recordAuditEvent`**, never
    `AuditRepo.write` directly. Validates the canonical shape +
    strips NFR8 forbidden material.
14. **`safeAudit` in `application/_audit-context.ts`** — every
    application-layer auth flow uses this so an audit-write
    failure doesn't mask the real outcome.
15. **MFA-presence check is pluggable via `deps.isMfaPresent`** —
    default trusts AuthKit; T-010 will swap in a stricter check
    once `listAuthFactors` is added to the WorkOS wrapper.
16. **Multi-write transactions are NOT yet wired in any
    application function.** Signup orphans an org if membership
    create fails; same risk for any future multi-write flow. See
    "Pending follow-ups" above.
17. **Login resolves WorkOS org id → local UUID via
    `orgRepo.findByWorkosOrgId`** — `session.organizationId` is
    the WorkOS-side text id, NOT our local UUID. Bug Cursor caught
    on PR #9.
18. **Signup stamps `mfaEnrolledAt` + `emailVerifiedAt` at
    create-time** (T-007's `CreateUserInput` was extended).
    Without this, fresh signups would fail their first login on
    the FR16 MFA gate. Bug Cursor caught on PR #9.
19. **Suspension revokes WorkOS sessions BEFORE flipping local
    lifecycle.** The spec's "timing test" asserts this ordering
    via `mock.invocationCallOrder`. A revoke failure leaves our
    DB consistent — better than the opposite.
20. **`WorkOSClient.listSessions(userId)` auto-paginates** —
    returns a flat `Session[]`. T-011 reuses this for the
    revoke-all-on-completion path.
21. **Cursor Bugbot has caught real bugs on every PR with
    multi-step or external-ID flows.** Always read its findings
    before merging; if it flags something, write a regression
    test that proves the fix before pushing.
22. **Authorization (only owner / admin can X) is a handler-layer
    concern (T-014).** Application functions enforce data
    invariants only — self-suspension, sole-owner protection,
    schema validation. Don't put role checks in
    `application/*.ts`.
23. **`requestPasswordReset` deliberately skips a local
    `findByEmail` lookup** — it would leak account existence via
    timing differences (DB hit vs miss) and add no functional
    value (WorkOS is the source of truth). T-011's file header
    documents this.
24. **`requestPasswordReset` swallows the WorkOS error message
    entirely**, including from the audit metadata — only a generic
    `reason: "delegate_error"` is written. WorkOS error strings
    differ between known/unknown emails; if any of them ever leak
    to the response or to a downstream consumer of the audit,
    enumeration becomes possible. Tests pin the audit metadata to
    a closed shape (not `objectContaining`) to catch a future
    field-addition leak.
25. **`handlePasswordResetCompleted` returns null on
    `user_not_found` rather than throwing** — webhooks must be
    redeliverable; a throw would force WorkOS into a permanent
    retry loop for an event we'll never act on.
26. **`Promise.all` vs `Promise.allSettled` choice is
    flow-dependent.** Suspension uses `Promise.all` (revoke
    failure must skip the lifecycle flip). Password-reset
    completion uses an `allSettled`-style per-task try/catch so
    every revoke runs even when one fails — the audit row carries
    `{ attempted, succeeded, failed }` for forensics. Both are
    intentional; copy whichever matches the new flow's semantics.
27. **Recovery codes are entirely owned by AuthKit per ADR-003.**
    Plaintext codes never enter our system. The
    `getRecoveryCodesForDownload` method the original T-010 spec
    mentioned is intentionally NOT implemented. FR17(c)
    (regenerate) is a deferred follow-up.
28. **`mfa_enrolled` webhook handler always re-mirrors
    `users.mfa_enrolled_at` even on redelivery** — no idempotency
    guard. The DB write is cheap and webhook redeliveries are
    rare; a guard would add branch + test for negligible win.
    Audit dedup is the webhook routing layer's job (T-016).
29. **Recovery-code-used audit metadata is closed-shape `{}`** by
    contract (ADR-003 follow-up #4). The unit test pins this with
    `toEqual({})` not `objectContaining` — any future regression
    that adds an `id` / `codeHash` / `code` field breaks it on
    purpose. Defence-in-depth on top of the NFR8 strip.
30. **Multi-write transactions use the `withTx(tx)` factory
    pattern.** Every T-007 repo accepts `DbOrTx` in its
    constructor and exposes `withTx(tx: Tx): ThisRepo`. Application
    functions take a `db: Db` dep and call
    `db.transaction(async (tx) => { repo.withTx(tx).create(...) })`
    so a mid-sequence failure rolls every write back. **Awaits
    inside the callback MUST stay sequential** — Drizzle's `tx`
    handle wraps a single Postgres connection, so concurrent
    awaits interleave commands and risk
    `another command is already in progress`. signup.ts is the
    template; T-009 and T-019 will copy this shape.
31. **Audit writes deliberately stay OUTSIDE the caller's
    transaction.** `safeAudit` is called after `db.transaction`
    resolves, on purpose: an audit-write failure shouldn't roll
    business state back, and a transaction rollback shouldn't
    erase the audit row of the failure we wanted to record.
    `AuditRepo` does still have a `withTx` for the rare case a
    caller wants in-tx audit, but signup.ts shows the standard
    pattern.

## Workflow conventions in one paragraph

Branch off `main` per task (`feat/<slice>-T-XXX-<short-desc>`),
one task one PR. Run the full guard set locally before pushing.
Write the simplify-skill review **after** tests pass and **before**
committing — it has caught real wins on every recent PR. Cursor
Bugbot runs on every PR and has caught real bugs on every flow
with external IDs or multi-step ordering. Tasks.md ticks `[~]`
mid-PR and `[x]` after merge. HANDOFF.md is rewritten at every
transition; if you finish a task and there's no next one in
flight, this file gets the brief for the next pickup.
