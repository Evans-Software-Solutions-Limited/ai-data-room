# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-03 by Claude Code, mid-flight on T-010.
Branch `feat/auth-and-orgs-T-010-mfa-enrolment` is open and awaiting
review. T-011 (password reset) merged earlier today as PR #12.

## Currently in flight

**T-010 — application-layer MFA enrolment hook + recovery-code-used
audit.** PR open against `main`.

- `adr/003-recovery-codes-delegated-to-authkit.md` — resolves a
  three-way contradiction across `requirements.md` / `design.md` /
  `tasks.md` about who owns the recovery-codes UX. Decision:
  delegate entirely to AuthKit; we never see plaintext codes.
- `microservices/core/src/application/mfa.ts` — two webhook
  reactions: `handleMfaEnrolled` mirrors `users.mfa_enrolled_at`
  and audits, `handleRecoveryCodeUsed` audits only.
- `microservices/core/src/application/__tests__/mfa.test.ts` —
  5 unit tests (happy + idempotency + closed-shape metadata
  invariants).
- `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md` — T-010 scope
  rewritten to match ADR-003.

Local guard set green: `typecheck` (force) + `test:unit` (force,
105/105, mfa.ts 100/100/100/100) + `lint` + `prettier:check`.
Awaiting CI + Cursor Bugbot + Brad's review.

### Why this is a small PR

ADR-003 trims T-010's original scope significantly. The original
spec wanted us to expose `getRecoveryCodesForDownload` — but
`design.md` explicitly says "we never see plaintext codes". Three
options on the table; we picked "delegate everything to AuthKit"
because (a) it matches `design.md`, (b) AuthKit already shows +
downloads codes during the enrolment redirect, and (c) it keeps
the SOC 2 evidence surface narrow. The ADR documents the
follow-ups (FR17(c) regenerate; `listAuthFactors` wrapper for the
HANDOFF #15 stricter MFA-presence check) so they don't get lost.

### Departures from the brief after the simplify review

1. **Per-function deps + result interfaces** instead of a shared
   `MfaWebhookDeps` / `MfaWebhookResult`. `handleRecoveryCodeUsed`
   takes `Pick<UserRepo, "findByWorkosUserId">` — it never mutates,
   so the deps interface advertises that. Mirrors the password-
   reset.ts pattern (PR #12).
2. **Dropped a redundant timestamp-drift test.** The happy-path
   assertion already pins `setMfaEnrolledAt(USER_ID, ENROLLED_AT)`
   — a separate test for "uses the webhook timestamp" was
   asserting the same invariant from a different angle, with a
   paragraph of justifying comment that gave it away as redundant.
3. **No `lookupOrAuditFailure` helper extracted yet.** The
   "lookup user → audit-failure-and-return-null on miss → otherwise
   process" pattern now exists in 3 webhook handlers
   (password-reset, mfa-enrolled, recovery-code-used). Both
   reviewers concluded 3-callers-but-shallow-divergence isn't yet
   worth it; revisit when a 4th caller (likely `email_verified` or
   an org-membership webhook) lands and forces a `metadataExtra`
   parameter.

### Deliberately not done in this PR (reviewer flagged, deferred)

- **Extract `AUDIT_REASONS` constants** — `"user_not_found"`,
  `"revoke_failed"`, `"delegate_error"` are stringly-typed across
  password-reset.ts and mfa.ts. Cross-file refactor; not in
  T-010's scope.
- **Extract a `lookupOrAuditFailureForWebhook` helper** — see #3
  above. Wait for the 4th caller.
- **Existing carryovers:** shared `revokeAllActiveSessions` helper
  (suspension + password-reset), shared test fixtures
  (`makeUser` / `makeSession` / `makeDeps`), and the
  `AuthFlowError<TReason>` generic — all flagged before, all still
  deferred.

## Where we are in slice 1 (auth-and-orgs)

| Task  | Status                     | Notes                                                                     |
| ----- | -------------------------- | ------------------------------------------------------------------------- |
| T-001 | ✅                         | Repo scaffold.                                                            |
| T-002 | ✅                         | WorkOS + secrets wiring (PR #1).                                          |
| T-003 | ✅                         | Postgres + Drizzle setup (PR #3).                                         |
| T-004 | ✅                         | Domain types + zod schemas (PR #4).                                       |
| T-005 | ✅                         | Postgres-specific DDL augments (PR #5).                                   |
| T-006 | ✅                         | WorkOS client wrapper + webhook verifier (PR #6).                         |
| T-007 | ✅                         | Typed Drizzle repositories (PR #7).                                       |
| T-013 | ✅                         | Application-layer audit event writer (PR #8).                             |
| T-008 | ✅                         | Signup + login callback flows (PR #9).                                    |
| T-012 | ✅                         | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).              |
| T-011 | ✅                         | Password reset (PR #12).                                                  |
| T-010 | 🟡 **in flight** (this PR) | MFA enrolment hook + recovery-code-used audit (scope trimmed by ADR-003). |
| T-009 | ⏳                         | Application: invitations.                                                 |
| T-014 | ⏳                         | Handlers: HTTP routes (depends on the application-layer fan-out below).   |
| T-015 | ⏳                         | Session middleware + `/me` (depends on T-014).                            |
| T-016 | ⏳                         | WorkOS webhook handler routing — best landed AFTER T-008–T-012 / T-019.   |
| T-017 | ⏳                         | Minimal web shell (login / signup / MFA / `/me`).                         |
| T-018 | ⏳                         | Observability (logs / metrics / alerts).                                  |
| T-019 | ⏳                         | GDPR hard-delete.                                                         |
| T-020 | ⏳                         | Rate limiting + NFR hardening.                                            |
| T-021 | ⏳                         | Playwright acceptance suite.                                              |
| T-022 | ⏳                         | Slice sign-off + traceability matrix + tag.                               |

## Recommended next pick after T-010 merges

The application-layer fan-out is nearly done. After T-010 merges,
only **T-009 (invitations)** and **T-019 (GDPR hard-delete)** remain
in the application layer — and both are gated on the multi-write
transaction follow-up (see #1 below). So the recommended order is:

1. **Multi-write transaction wrapping** (the deferred follow-up).
   Half a day of work; unblocks T-009 and T-019 to land cleanly
   without the orphan-on-failure risk that signup currently has.
2. **T-009 (invitations)** — biggest of the remaining application
   tasks. Multi-write (invitations row + sometimes
   external_access_grants); needs the txn wrapper from step 1.
3. **T-019 (GDPR hard-delete)** — also multi-write; same txn
   prerequisite.
4. **T-016 (webhook routing)** — best landed AFTER all the
   application functions exist, since it routes events to all of
   them. Validates the `mfa_enrolled` / `recovery_code_used` /
   `password_reset.succeeded` event handlers we've been writing.

### Faster alternative if Brad wants a small win

If a smaller PR is preferable, knock out **one of the deferred
refactors** before the next application task:

- Extract `revokeAllActiveSessions` helper (suspension +
  password-reset); ~50 LOC + test updates.
- Extract `AUDIT_REASONS` constants for the
  `"user_not_found"` / `"revoke_failed"` / `"delegate_error"`
  string literals across password-reset.ts and mfa.ts.
- Add `listAuthFactors` to the WorkOS wrapper + swap the
  `isMfaPresent` default in signup/login (per HANDOFF #15).

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
