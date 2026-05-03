# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-03 by Claude Code, mid-flight on T-011.
Branch `feat/auth-and-orgs-T-011-password-reset` is open and awaiting
review.

## Currently in flight

**T-011 — application-layer password reset.** PR open against `main`.
Diff is two new files:

- `microservices/core/src/application/password-reset.ts` (~190 LOC)
- `microservices/core/src/application/__tests__/password-reset.test.ts` (~310 LOC, 8 cases)

Local guard set green: `typecheck` (force) + `test:unit` (force,
14/14, password-reset 100/100/100/100) + `lint` + `prettier:check`.
Awaiting CI + Cursor Bugbot + Brad's review.

### Shape that landed (vs. the brief in PR #11's HANDOFF)

Followed the brief closely; departed in three places after the
`simplify` review:

1. **Two error classes, not one.** `PasswordResetRequestError`
   (reason `invalid_email`) lives in the request flow only;
   `PasswordResetCompletionError` (reason `revoke_failed`) lives in
   the completion flow. The two callers will never catch both, so a
   union shape was indirection without value.
2. **`Promise.allSettled`-style fan-out, not `Promise.all`.** Lets
   every revoke run even when one rejects, so the failure-audit row
   carries `{ attempted, succeeded, failed }`. FR20 still treats any
   rejection as hard failure (we throw); the per-attempt breakdown
   is forensic only. Suspension (T-012) still uses `Promise.all` —
   if a revoke fails there, the lifecycle flip is skipped, which is
   the right outcome for that flow.
3. **No emit-helper extraction.** The 5 `safeAudit` calls have
   different metadata shapes (email-only / workosUserId-only /
   per-attempt counts / revokedSessions count), so suspension's
   `emitFailure`-style helper would have added indirection without
   saving lines. Kept inline.

### Deliberately not done in this PR (reviewer flagged, deferred)

- **Extract a shared `revokeAllActiveSessions` helper** —
  `password-reset.ts` and `suspension.ts` now have identical
  list-then-filter-then-fan-out blocks. Would land best as a tiny
  refactor PR after T-011 merges; touches both files + their tests.
- **Extract shared test fixtures** (`makeUser` / `makeSession` /
  `makeDeps`) — duplicated across `suspension.test.ts` and
  `password-reset.test.ts`. Same shape as above: refactor PR, not
  inside T-011.
- **`AuthFlowError<TReason>` generic** — already on the deferred
  list from PR #10's HANDOFF; nothing changed.

## Where we are in slice 1 (auth-and-orgs)

| Task  | Status                     | Notes                                                                   |
| ----- | -------------------------- | ----------------------------------------------------------------------- |
| T-001 | ✅                         | Repo scaffold.                                                          |
| T-002 | ✅                         | WorkOS + secrets wiring (PR #1).                                        |
| T-003 | ✅                         | Postgres + Drizzle setup (PR #3).                                       |
| T-004 | ✅                         | Domain types + zod schemas (PR #4).                                     |
| T-005 | ✅                         | Postgres-specific DDL augments (PR #5).                                 |
| T-006 | ✅                         | WorkOS client wrapper + webhook verifier (PR #6).                       |
| T-007 | ✅                         | Typed Drizzle repositories (PR #7).                                     |
| T-013 | ✅                         | Application-layer audit event writer (PR #8).                           |
| T-008 | ✅                         | Signup + login callback flows (PR #9).                                  |
| T-012 | ✅                         | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).            |
| T-011 | 🟡 **in flight** (this PR) | Application: password reset.                                            |
| T-009 | ⏳                         | Application: invitations.                                               |
| T-010 | ⏳                         | Application: MFA enrolment hook + recovery codes UX contract.           |
| T-014 | ⏳                         | Handlers: HTTP routes (depends on the application-layer fan-out below). |
| T-015 | ⏳                         | Session middleware + `/me` (depends on T-014).                          |
| T-016 | ⏳                         | WorkOS webhook handler routing — best landed AFTER T-008–T-012 / T-019. |
| T-017 | ⏳                         | Minimal web shell (login / signup / MFA / `/me`).                       |
| T-018 | ⏳                         | Observability (logs / metrics / alerts).                                |
| T-019 | ⏳                         | GDPR hard-delete.                                                       |
| T-020 | ⏳                         | Rate limiting + NFR hardening.                                          |
| T-021 | ⏳                         | Playwright acceptance suite.                                            |
| T-022 | ⏳                         | Slice sign-off + traceability matrix + tag.                             |

## Recommended next pick after T-011 merges

**T-010 — MFA enrolment hook + recovery codes UX contract.**

- Bounded scope. Two webhook reactions (`mfa_enrolled`,
  `recovery_code_used`) + a `getRecoveryCodesForDownload` method
  with a one-shot gate.
- Same shape as T-011: webhook-driven mirror updates + audit emit.
- Doesn't have the multi-write transaction concern that's still
  blocking T-009 / T-019. (See pending follow-up #1 below.)
- Finalises the recovery-codes contract that T-017's web shell will
  consume.

### Alternatives, in order of preference

- **T-009 (invitations)** — multi-write (creates `invitations` row,
  sometimes `external_access_grants` too). Should land AFTER the
  multi-write transaction follow-up below. ~2x the LOC of T-011.
- **T-019 (GDPR hard-delete)** — multi-write (PII scrub + audit).
  Same transaction caveat as T-009.
- **T-016 (webhook routing)** — best AFTER T-009 / T-010 / T-011 /
  T-019 land, since it routes events to all of them.
- **The two reviewer-flagged refactors** (session-revocation helper
  and shared test fixtures) if you want a tidy session before the
  next application task.

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
