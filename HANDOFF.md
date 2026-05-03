# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-03 by Claude Code, mid-flight on T-009.
Branch `feat/auth-and-orgs-T-009-invitations` is open and awaiting
review. The txn-wrapper refactor merged earlier today as PR #14.

## Currently in flight

**T-009 — application-layer invitations.** Four functions covering
the full invitation lifecycle: `createInvitation` (internal +
external variants), `listInvitations`, `revokeInvitation`,
`acceptInvitation` (the multi-write webhook handler — first
production use of the `withTx` pattern from PR #14).

Authorization split per HANDOFF #22: handlers (T-014) gate "signed
in + some org role"; this file enforces the domain-specific role
rules (only owner can invite an admin, revoke requires
owner-or-admin). FR8 token entropy / 7-day expiry is delegated to
WorkOS.

What changed:

- `microservices/core/src/application/invitations.ts` (~430 LOC) —
  the four functions plus `InvitationError` taxonomy and an
  `emitFailure` helper for the create / revoke failure-audit
  shape.
- `microservices/core/src/application/__tests__/invitations.test.ts`
  (~700 LOC, 24 tests) — covers each authorization branch, the
  internal vs external invite variants, the WorkOS-then-DB
  ordering test, multi-write rollback, webhook idempotency, and
  the new schema-invariant defence.
- `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md` — T-009
  flipped to in-progress.

Local guard set green: `typecheck` (force), `test:unit` (force —
129/129 with invitations.ts at 100/98/100/100, well above the 90%
gate), `lint`, `prettier:check`. Awaiting CI + Cursor Bugbot +
Brad's review.

### Departures from the brief after the simplify review

1. **Schema-invariant defence in `acceptInvitation`** — the
   invitation row arrives from the DB unparsed. A manual UPDATE
   that violated the schema's `(kind, role, opportunitySlug)`
   invariant would let null through to the
   `membership.create({ role: null })` call and surface as an
   opaque Drizzle NOT NULL violation. Replaced the non-null
   assertions with explicit guards that throw a typed
   `InvitationError("invitation_invariant_violation")` instead.
   Two regression tests cover both the internal-with-null-role
   and external-with-null-slug shapes.
2. **Dropped a redundant `{ ...input, audit: input.audit }`
   spread** in `revokeInvitation`'s failure-audit calls. `input`
   already had `audit`; the explicit re-set was dead code.
3. **Trimmed the file header** from a 30-line bullet recap (each
   function got its own paragraph) down to the load-bearing
   authorization-split + idempotency notes. Readable function
   signatures already say what each function does.
4. **`emitFailure` doc trimmed** — kept the WHY (which paths
   it covers, why webhook paths use `safeAudit` directly), dropped
   the WHAT-arithmetic about saved boilerplate lines.

### Deliberately not done in this PR (reviewer flagged, deferred)

- **`lookupOrAuditFailureForWebhook` extraction** — `acceptInvitation`
  is the 4th call site of the "lookup → if missing audit + return
  null" pattern (joining password-reset + the two MFA handlers).
  HANDOFF said "revisit when a 4th caller lands" — and it has, but
  this PR isn't the right scope. The other 3 callers key on
  `workosUserId` returning `User`; `acceptInvitation` keys on
  `workosInvitationId` returning `Invitation`. Generic helper would
  need to thread a lookup fn + handle the second invariant branch
  (`invitation.state !== "pending"`). Worth doing as a
  cross-aggregate refactor PR after T-009 ships.
- **Splitting `Invitation` into a discriminated union** at the
  schema level — would remove the need for the runtime
  invariant-check branches in `acceptInvitation`. Currently zod's
  `discriminatedUnion` doesn't compose with the `superRefine`
  cross-field nullability the schema uses. Schema refactor;
  defer.
- **Existing carryovers:** all the deferreds from previous PRs
  still apply (shared test fixtures, `AUDIT_REASONS` constants,
  `AuthFlowError<TReason>` generic, `revokeAllActiveSessions`
  helper).

## Where we are in slice 1 (auth-and-orgs)

| Task  | Status                     | Notes                                                                          |
| ----- | -------------------------- | ------------------------------------------------------------------------------ |
| T-001 | ✅                         | Repo scaffold.                                                                 |
| T-002 | ✅                         | WorkOS + secrets wiring (PR #1).                                               |
| T-003 | ✅                         | Postgres + Drizzle setup (PR #3).                                              |
| T-004 | ✅                         | Domain types + zod schemas (PR #4).                                            |
| T-005 | ✅                         | Postgres-specific DDL augments (PR #5).                                        |
| T-006 | ✅                         | WorkOS client wrapper + webhook verifier (PR #6).                              |
| T-007 | ✅                         | Typed Drizzle repositories (PR #7).                                            |
| T-013 | ✅                         | Application-layer audit event writer (PR #8).                                  |
| T-008 | ✅                         | Signup + login callback flows (PR #9).                                         |
| T-012 | ✅                         | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).                   |
| T-011 | ✅                         | Password reset (PR #12).                                                       |
| T-010 | ✅                         | MFA enrolment + recovery-code-used audit (PR #13, scope trimmed by ADR-003).   |
| –     | ✅                         | Chore: repos accept `Db \| PgTransaction` + signup wraps multi-write (PR #14). |
| T-009 | 🟡 **in flight** (this PR) | Application: invitations (4 functions, multi-write `acceptInvitation`).        |
| T-014 | ⏳                         | Handlers: HTTP routes (depends on the application-layer fan-out below).        |
| T-015 | ⏳                         | Session middleware + `/me` (depends on T-014).                                 |
| T-016 | ⏳                         | WorkOS webhook handler routing — best landed AFTER T-008–T-012 / T-019.        |
| T-017 | ⏳                         | Minimal web shell (login / signup / MFA / `/me`).                              |
| T-018 | ⏳                         | Observability (logs / metrics / alerts).                                       |
| T-019 | ⏳                         | GDPR hard-delete.                                                              |
| T-020 | ⏳                         | Rate limiting + NFR hardening.                                                 |
| T-021 | ⏳                         | Playwright acceptance suite.                                                   |
| T-022 | ⏳                         | Slice sign-off + traceability matrix + tag.                                    |

## Recommended next pick after T-009 merges

The application-layer fan-out has one task left:

1. **T-019 (GDPR hard-delete)** — webhook-driven (`user.deleted`).
   Multi-write (PII scrub on `users` row + audit). Smaller than
   T-009; uses the `withTx` template established by signup.ts and
   acceptInvitation. After this lands, **every application-layer
   function the slice needs exists**.
2. **T-016 (WorkOS webhook routing)** — best landed AFTER T-019,
   since it routes events to all the application handlers we've
   written. Validates `mfa_enrolled` / `recovery_code_used` /
   `password_reset.succeeded` / `invitation.accepted` /
   `user.deleted` end-to-end.
3. **T-014 (HTTP handlers)** — wires the application layer to
   API Gateway. Can run in parallel with T-016 since they touch
   different routes (auth + auth/\* + /me vs /webhooks/workos).
4. **T-015 (session middleware + /me)** — depends on T-014.
5. **T-017 (web shell)** — final functional gate before T-021
   Playwright e2e and T-022 sign-off.

### Faster alternatives if Brad wants a small win first

- **`lookupOrAuditFailureForWebhook` helper** — now genuinely
  warranted (4 callers).
- Extract `revokeAllActiveSessions` helper (suspension +
  password-reset).
- Extract `AUDIT_REASONS` constants for the stringly-typed
  `metadata.reason` literals across password-reset, mfa, and
  invitations.
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
