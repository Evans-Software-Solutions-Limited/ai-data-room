# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-04 by Claude Code, post-T-016 merge. No
task currently in flight — branch is clean, `main` is the head
everywhere. T-016 (WorkOS webhook routing) merged as PR #17.

## Where we are in slice 1 (auth-and-orgs)

The application-layer fan-out is complete. The webhook routing
surface is wired. **Next up is the user-facing HTTP surface — the
biggest remaining task in the slice.**

| Task  | Status      | Notes                                                                              |
| ----- | ----------- | ---------------------------------------------------------------------------------- |
| T-001 | ✅          | Repo scaffold.                                                                     |
| T-002 | ✅          | WorkOS + secrets wiring (PR #1).                                                   |
| T-003 | ✅          | Postgres + Drizzle setup (PR #3).                                                  |
| T-004 | ✅          | Domain types + zod schemas (PR #4).                                                |
| T-005 | ✅          | Postgres-specific DDL augments (PR #5).                                            |
| T-006 | ✅          | WorkOS client wrapper + webhook verifier (PR #6).                                  |
| T-007 | ✅          | Typed Drizzle repositories (PR #7).                                                |
| T-013 | ✅          | Application-layer audit event writer (PR #8).                                      |
| T-008 | ✅          | Signup + login callback flows (PR #9).                                             |
| T-012 | ✅          | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).                       |
| T-011 | ✅          | Password reset (PR #12).                                                           |
| T-010 | ✅          | MFA enrolment + recovery-code-used audit (PR #13, scope trimmed by ADR-003).       |
| –     | ✅          | Chore: repos accept `Db \| PgTransaction` + signup wraps multi-write (PR #14).     |
| T-009 | ✅          | Application: invitations (PR #15, 4 functions incl. multi-write acceptInvitation). |
| T-019 | ✅          | GDPR hard-delete (PR #16, NFR9 audit-continuity proven by real JOIN test).         |
| T-016 | ✅          | WorkOS webhook routing + dedup ledger (PR #17).                                    |
| T-014 | 🎯 **next** | Handlers: HTTP routes (auth-callback, invitations, suspend, audit-events).         |
| T-015 | ⏳          | Session middleware + `/me` (depends on T-014).                                     |
| T-017 | ⏳          | Minimal web shell (login / signup / MFA / `/me`).                                  |
| T-018 | ⏳          | Observability (logs / metrics / alerts).                                           |
| T-020 | ⏳          | Rate limiting + NFR hardening.                                                     |
| T-021 | ⏳          | Playwright acceptance suite.                                                       |
| T-022 | ⏳          | Slice sign-off + traceability matrix + tag.                                        |

## Next pickup: T-014 — HTTP handlers

The largest remaining task in the slice. Scope per `tasks.md`
§T-014 covers a lot of surface: every authenticated route in
`design.md` §Interfaces, plus session + CSRF + rate-limit
middleware, plus integration tests against the SST dev stack.

### Recommended scope split (decision before starting)

Three honest ways to slice this. The PR is too big to land in one
piece without losing reviewability.

- **(A) T-014a — public auth routes only.** Wires
  `GET /auth/login`, `GET /auth/signup`, `GET /auth/callback`
  (exchanges code → calls `handleSignup` or `handleLoginCallback`),
  `POST /auth/logout`. Adds the AuthKit redirect helpers + the
  callback that mints the session cookie via WorkOS. CSRF
  middleware is included for the logout POST. No protected
  routes; no session middleware (those land in T-015 alongside
  `/me`). T-014b (protected routes) becomes a follow-up after
  T-015. Smallest reviewable unit. **Recommended default.**
- **(B) T-014 full scope.** Public auth routes plus session
  middleware, CSRF, and all protected routes (invitations,
  suspend / unsuspend, audit-events). Massive PR (~1500+ LOC),
  hard to review, effectively bundles T-015 into T-014.
- **(C) T-014 + reabsorb T-015.** Recognise that T-014 and T-015
  are tightly coupled and merge them into one task with a single
  bigger PR. Cleaner spec but the same scope as (B).

**Recommend (A).** Brief Brad explicitly before starting so he can
redirect if he wants the larger split.

### Files for the (A) shape

- `microservices/core/src/handlers/auth/loginGetHandler.ts`
- `microservices/core/src/handlers/auth/signupGetHandler.ts`
- `microservices/core/src/handlers/auth/callbackGetHandler.ts`
- `microservices/core/src/handlers/auth/logoutPostHandler.ts`
- `microservices/core/src/middleware/csrf.ts`
- `microservices/core/src/api.ts` — mount the new handlers
- Per-handler unit tests + integration test for the callback flow

### Patterns to mirror

- **`healthWorkosGetHandler.ts`** for the Elysia plugin shape +
  the `vi.doMock("sst", ...)` test pattern.
- **`workos.ts` + `workosLambda.ts` (T-016)** for splitting pure
  routing logic (testable) from production wiring (excluded from
  the unit coverage gate). The auth handlers are smaller so
  splitting may not be needed; judgement call per handler.
- **Existing application functions** — handlers should be thin:
  validate input → call application function → translate result
  to HTTP. No business logic at the handler layer.

### Things to think about up front

1. **Session cookie format.** AuthKit issues sealed cookies via
   `@workos-inc/authkit-js` (or our wrapper around it). The
   callback handler is where this happens. Need to decide cookie
   name, scope, secure flags. Per NFR7: `HttpOnly`, `Secure`,
   `SameSite=Lax` or stricter.
2. **AuthKit redirect URI.** WorkOS needs a registered redirect
   URI per stage. The callback handler reads the stage's URI from
   `Resource.<URL_HINT>.value` or hard-codes per-stage. Worth a
   quick decision before writing the handler.
3. **`workosClientId` threading.** `signup.ts` and `login.ts`
   take `workosClientId` as input (not from a deps factory) so
   the handler reads `Resource.WORKOS_CLIENT_ID.value` and passes
   it down. Clear, no surprise.
4. **CSRF for logout.** The single mutating public route is
   `POST /auth/logout`. CSRF double-submit token + middleware.
   T-020 will widen to all mutating routes; for T-014a we just
   land the middleware shape.

### Faster alternatives if Brad wants a small win first

Three deferred refactors are still warranted:

- **`lookupUserOrAuditFailureForWebhook` helper** — 4 user-keyed
  webhook callers now (password-reset, mfa-enrolled,
  recovery-code-used, deletion). Cross-aggregate refactor PR.
  Genuinely earned its keep.
- **WorkOS event-name investigation for MFA** — figure out which
  real WorkOS events should drive `handleMfaEnrolled` /
  `handleRecoveryCodeUsed`. May need an SDK upgrade or
  `user.updated` mfaFactors-transition logic. Small focused PR.
- **`AUDIT_REASONS` constants** — the stringly-typed
  `metadata.reason` literals across password-reset, mfa,
  invitations, deletion. Cross-file extraction.

## Pending follow-ups (not blocking, but worth doing soon)

1. **`AuthFlowError` generic** — `SignupError`, `LoginError`,
   `SuspensionError`, `PasswordResetRequestError`,
   `PasswordResetCompletionError`, `InvitationError` are nearly
   identical class shells. Could extract a generic
   `AuthFlowError<R extends string>` to `application/_errors.ts`.
   Low priority but clean if a future task is in the
   neighbourhood.
2. **`revokeAllActiveSessions` helper** — `password-reset.ts` and
   `suspension.ts` have identical list-then-filter-then-fan-out
   blocks. Tiny refactor; touches both files + their tests.
3. **Shared application-test fixtures** — `makeUser` /
   `makeSession` / `makeOrg` etc. duplicate across 7+ test files
   now. Consolidation refactor.
4. **`scripts/manual-gdpr-delete.ts`** — referenced in the
   `ops/runbooks/gdpr-delete.md` runbook as the WorkOS-down
   fallback. Doesn't exist yet; flagged as Phase 2.
5. **MFA application handler wiring** — `handleMfaEnrolled` and
   `handleRecoveryCodeUsed` exist but aren't reachable by any
   webhook (T-016 acks the relevant event types as ignored).
   Wire once the WorkOS event-name investigation lands.
6. **`session.revoked` cache bust** — webhook acks the event but
   doesn't bust the session cache (which doesn't exist yet —
   lands in T-015). Wire then.

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
   with a `*.down.sql` outside the migrations folder drizzle
   reads.
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
    — the id half is load-bearing for events sharing a
    millisecond.
13. **All audit writes go through
    `application/audit.ts#recordAuditEvent`**, never
    `AuditRepo.write` directly. Validates the canonical shape +
    strips NFR8 forbidden material.
14. **`safeAudit` in `application/_audit-context.ts`** — every
    application-layer auth flow uses this so an audit-write
    failure doesn't mask the real outcome.
15. **MFA-presence check is pluggable via `deps.isMfaPresent`** —
    default trusts AuthKit; investigation deferred until WorkOS
    event-name mapping for `mfa_enrolled` is settled.
16. **Multi-write transaction wrapping uses the `withTx(tx)`
    factory pattern.** Every T-007 repo accepts `DbOrTx` and
    exposes `withTx(tx: Tx): ThisRepo`. Application functions
    call `db.transaction(async (tx) => repo.withTx(tx).create(...))`.
    **Awaits inside the txn callback MUST stay sequential** —
    Drizzle's tx handle wraps a single Postgres connection.
17. **Login resolves WorkOS org id → local UUID via
    `orgRepo.findByWorkosOrgId`** — `session.organizationId` is
    the WorkOS-side text id, NOT our local UUID. Bug Cursor
    caught on PR #9.
18. **Signup stamps `mfaEnrolledAt` + `emailVerifiedAt` at
    create-time** (T-007's `CreateUserInput` was extended).
    Without this, fresh signups would fail their first login on
    the FR16 MFA gate. Bug Cursor caught on PR #9.
19. **Suspension revokes WorkOS sessions BEFORE flipping local
    lifecycle.** The spec's "timing test" asserts this ordering
    via `mock.invocationCallOrder`. A revoke failure leaves our
    DB consistent — better than the opposite.
20. **`WorkOSClient.listSessions(userId)` auto-paginates** —
    returns a flat `Session[]`. Reused by the
    revoke-all-on-password-reset path.
21. **Cursor Bugbot has caught real bugs on every PR with
    multi-step or external-ID flows.** Always read its findings
    before merging; if it flags something, write a regression
    test that proves the fix before pushing.
22. **Authorization (only owner / admin can X) is a handler-layer
    concern (T-014).** Application functions enforce data
    invariants only — self-suspension, sole-owner protection,
    schema validation. Don't put role checks in
    `application/*.ts`. Exception: invitations.ts enforces the
    `actorRole`-vs-`invitationRole` rule (only owner can invite
    admin) because it's a domain-specific permission, not a
    handler-layer "is signed in" check.
23. **`requestPasswordReset` deliberately skips a local
    `findByEmail` lookup** — would leak account existence via
    timing. Documented in T-011's file header.
24. **`requestPasswordReset` swallows the WorkOS error message
    entirely** — only a generic `reason: "delegate_error"` lands
    in the audit. WorkOS error strings differ between
    known/unknown emails; tests pin the audit metadata to a
    closed shape (`toEqual`, not `objectContaining`) to catch a
    future field-addition leak.
25. **Webhook handlers return null on lookup-miss rather than
    throwing** — webhooks must be redeliverable; a throw would
    force WorkOS into a permanent retry loop for an event we'll
    never act on. Pattern across password-reset, mfa, invitations
    accept, deletion.
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
28. **Recovery-code-used audit metadata is closed-shape `{}`** by
    contract (ADR-003 follow-up #4). The unit test pins this
    with `toEqual({})` not `objectContaining` — any future
    regression that adds an `id` / `codeHash` / `code` field
    breaks it on purpose. Defence-in-depth on top of the NFR8
    strip.
29. **Invitation state transitions use atomic compare-and-set
    (`InvitationRepo.transitionState`)** — both `acceptInvitation`
    and `revokeInvitation` use it to close TOCTOU races against
    concurrent webhook deliveries. Returns null on race-loss;
    the application layer catches and rolls back the
    multi-write. Bug Bugbot caught on PR #15. Without this,
    `external_access_grants` could end up with duplicate rows
    (no unique constraint on that table).
30. **Cross-org tenancy guard on `revokeInvitation`** — the
    handler validates the actor's role in `input.orgId`, but
    `invitationId` is a globally-unique PK. After `findById`,
    the application function checks `invitation.orgId ===
input.orgId` and treats mismatch as not-found
    (information-hiding — don't reveal the invitation exists in
    another org). Bug Bugbot caught on PR #15.
31. **Webhook routing dedups via the `webhook_deliveries`
    table** keyed on the WorkOS event id. `INSERT ... ON
CONFLICT DO NOTHING` is the load-bearing primitive — first
    insert returns the row, redelivery returns 0 rows and the
    routing layer short-circuits to a 200 with `{ replay: true }`.
    Application handlers stay independently idempotent for state,
    but emit `failure / already_*` audit rows on redelivery,
    which is why dedup at the routing layer is required for the
    spec's "exactly one audit row" guarantee.
32. **Webhook handlers split: routing logic in `workos.ts`
    (testable, in coverage gate) + Lambda wrapper in
    `workosLambda.ts` (excluded from unit coverage gate, mirrors
    `src/api.ts`).** Production wires deps from `Resource.*` +
    `getDb()` + binds application handlers to `(input) => result`
    routes. The split avoids needing a 6-module mock just to
    bump coverage.
33. **WorkOS event names ≠ design.md event names.** The v8.13
    SDK does NOT expose `authentication.mfa_enrolled` or
    `authentication.recovery_code_used` as discriminated event
    types (the closest is `authentication.mfa_succeeded` for
    auth-time, not enrolment). T-016 acks these as
    `{ ignored: true }`; the application handlers exist but
    aren't reachable. Real WorkOS event mapping is a deferred
    investigation.
34. **API Gateway HTTP API v2 lowercases all header names**
    before invoking the Lambda. No need for TitleCase fallbacks
    on header lookups (`event.headers["workos-signature"]` is
    sufficient — never `event.headers["WorkOS-Signature"]`).
35. **Webhook handler 500-response bodies omit error messages**
    — WorkOS surfaces response bodies in its delivery log, and
    pg-driver errors can include connection strings or stack
    frame paths. The full error is `console.error`'d for
    forensics; the response body just says
    `{ reason: "handler_error" }`.
36. **Webhook dedup ordering: insert-then-route, NOT
    route-then-insert.** Trade-off: an application-handler
    exception leaves the dedup row in place, so WorkOS retries
    will short-circuit to replay rather than re-execute. Manual
    operator recovery is `DELETE FROM webhook_deliveries WHERE
event_id = '…'` followed by re-trigger. Acceptable for v0.1
    because the spec's "exactly one audit row" guarantee
    matters more than transient-failure auto-recovery.
37. **`migrate.integration.test.ts` `EXPECTED_TABLES` is
    exact-match.** Adding any new table to `schema/auth.ts`
    requires a one-line update to that array, otherwise the
    smoke test fails on count mismatch. CI caught this on T-016
    (PR #17).
38. **`sst-env.d.ts` is auto-generated by SST but committed.**
    If a new secret is declared in `infra/secrets.ts` between
    SST runs, the type entry won't appear until someone runs
    `bun sst dev` to regenerate. The pattern in T-016 was a
    manual edit with a `// MANUAL ENTRY (T-NNN)` marker; the
    next regen overwrites cleanly.

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
