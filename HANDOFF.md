# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-01 by Claude Code, immediately after T-012
merged via PR #10. No task is currently in flight — branch is clean,
`main` is the head everywhere.

## Where we are in slice 1 (auth-and-orgs)

Slice 1 is **about half landed**. The infrastructure layer is done;
the application-layer fan-out is mid-stream.

| Task  | Status      | Notes                                                                   |
| ----- | ----------- | ----------------------------------------------------------------------- |
| T-001 | ✅          | Repo scaffold.                                                          |
| T-002 | ✅          | WorkOS + secrets wiring (PR #1).                                        |
| T-003 | ✅          | Postgres + Drizzle setup (PR #3).                                       |
| T-004 | ✅          | Domain types + zod schemas (PR #4).                                     |
| T-005 | ✅          | Postgres-specific DDL augments (PR #5).                                 |
| T-006 | ✅          | WorkOS client wrapper + webhook verifier (PR #6).                       |
| T-007 | ✅          | Typed Drizzle repositories (PR #7).                                     |
| T-013 | ✅          | Application-layer audit event writer (PR #8).                           |
| T-008 | ✅          | Signup + login callback flows (PR #9).                                  |
| T-012 | ✅          | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).            |
| T-009 | ⏳          | Application: invitations.                                               |
| T-010 | ⏳          | Application: MFA enrolment hook + recovery codes UX contract.           |
| T-011 | 🎯 **next** | Application: password reset.                                            |
| T-014 | ⏳          | Handlers: HTTP routes (depends on the application-layer fan-out below). |
| T-015 | ⏳          | Session middleware + `/me` (depends on T-014).                          |
| T-016 | ⏳          | WorkOS webhook handler routing — best landed AFTER T-008–T-012 / T-019. |
| T-017 | ⏳          | Minimal web shell (login / signup / MFA / `/me`).                       |
| T-018 | ⏳          | Observability (logs / metrics / alerts).                                |
| T-019 | ⏳          | GDPR hard-delete.                                                       |
| T-020 | ⏳          | Rate limiting + NFR hardening.                                          |
| T-021 | ⏳          | Playwright acceptance suite.                                            |
| T-022 | ⏳          | Slice sign-off + traceability matrix + tag.                             |

## Recommended next pick: T-011 — application-layer password reset

T-011 is the cleanest next move because:

- **Tight scope** — two functions in one file, no schema or infra
  changes. PR sized like T-013 (~150 LOC application + tests).
- **No transaction concerns** — it's two independent flows, each
  one DB write at most. The multi-write transaction follow-up
  flagged in T-008's PR can keep waiting until T-009 / T-019
  actually need it.
- **Reuses `WorkOSClient.listSessions`** added in T-012 — validates
  the abstraction by exercising it from a second callsite.
- **Sets up T-016** — the `password_reset_completed` webhook
  handler will route through this file's
  `handlePasswordResetCompleted` once T-016 lands.

### Spec recap

From [`tasks.md` §T-011](./.kiro/specs/ai-data-room/auth-and-orgs/tasks.md#t-011--application-layer-password-reset):

> `requestPasswordReset` delegates to WorkOS's password-reset email
> flow. On `password_reset_completed` webhook, invalidate all
> sessions for the user via WorkOS `session.revoke`, write audit
> event.
>
> **DoD:** US5 acceptance reachable at application layer.
> **Tests:** Unit tests for both events.

### Suggested shape — `microservices/core/src/application/password-reset.ts`

Two exported functions, parallel to the
`signup` / `login` / `suspension` files:

```ts
// 1. User clicks "forgot password" — enters email — backend calls this.
async function requestPasswordReset(
  input: { email: string; audit: AuditContext },
  deps: { workos: WorkOSClient; auditRepo: AuditRepo },
): Promise<{ acknowledged: true }> {
  // Always delegate, even if the email is unknown — never reveal
  // whether an email is registered (privacy / enumeration defence).
  // Catch any WorkOS error (e.g. email-not-found) and audit it as
  // a failure but return success to the caller.
  // Audit: password_reset_requested.
}

// 2. WorkOS fires `password_reset_completed` webhook — T-016 routes
//    the verified payload here. Returns the affected user for the
//    handler to log (or null if we don't mirror them).
async function handlePasswordResetCompleted(
  input: { workosUserId: string; audit: AuditContext },
  deps: {
    workos: WorkOSClient;
    userRepo: UserRepo;
    auditRepo: AuditRepo;
  },
): Promise<{ revokedSessions: number; user: User | null }> {
  // Look up local user by workosUserId. If missing (rare — webhook
  // for an unmirrored user), audit and return null without throwing
  // — webhook redelivery should be idempotent.
  // List all WorkOS sessions, revoke each active one in parallel
  // (same pattern as suspension.ts).
  // Audit: password_reset_completed (success / failure with reason).
}
```

### Things to do exactly the same as T-012

- Use `safeAudit` from `application/_audit-context.ts` so an
  audit-write failure doesn't mask the real outcome.
- Use `Promise.all(sessions.filter(s => s.status === "active").map(...))`
  for the revocation fan-out.
- The completion handler doesn't need to flip lifecycle — that
  belongs to suspension. Password reset just terminates sessions
  and emails the user the new password.

### Things to consider

- **Privacy defence on `requestPasswordReset`**: WorkOS's
  `createPasswordReset` throws if the email isn't a known user.
  Don't propagate that error to the caller — emit a
  `password_reset_requested` audit with `outcome: "failure"` and
  return success. Otherwise the API leaks "this email is
  registered" via timing / error response (NFR8 spirit).
- **Idempotency on the completion handler**: T-016 will deliver
  the webhook at-least-once. The lookup → revoke flow needs to be
  safe under redelivery: if all sessions are already revoked,
  `Promise.all([])` is a no-op; the audit will record duplicates.
  T-016's handler is responsible for the actual dedup; T-011 can
  trust that.
- **T-011 spec mentions `session.revoke` (singular)**, but the
  same flow as suspension list-then-revoke-all is what FR8
  ("must invalidate all sessions") actually wants.

### Tests

- `requestPasswordReset` (3): happy path delegates to WorkOS +
  audits success; WorkOS throws (unknown email) → still returns
  acknowledged + audits failure; missing email argument throws.
- `handlePasswordResetCompleted` (4): happy path lists + revokes
  - audits; user_not_found returns null + audits failure (no
    throw — webhook idempotency); all sessions already revoked is a
    zero-revocation success; revoke failure surfaces and audits
    failure.

### What you need to do to ship T-011

1. `git checkout main && git pull` (this branch's chore commit
   should already be in main when you start).
2. `git checkout -b feat/auth-and-orgs-T-011-password-reset`.
3. Implement `application/password-reset.ts` per the shape above.
4. Tests at `application/__tests__/password-reset.test.ts`. Mock
   `WorkOSClient` + `UserRepo`; real `recordAuditEvent` against a
   mocked `AuditRepo` (the existing pattern from
   `suspension.test.ts`).
5. Run the simplify skill before committing — the reviewer caught
   real wins on every recent PR.
6. Guard set: `bun run typecheck && bun run test && bun run lint && bun run prettier:check`.
7. Tick T-011 `[~]` in `tasks.md`. Refresh HANDOFF.md for the
   next pickup.
8. Commit + push + open PR with the standard
   `feat(auth-and-orgs): T-011 ...` shape.
9. Watch the 6 active CI jobs (db-\* will skip; core-integration
   re-runs the T-007 repo suite because `microservices/core/**`
   changed).
10. Cursor Bugbot has caught real bugs on every PR with multi-step
    flows or external IDs. Expect it to flag something on T-011 —
    review carefully and fix on the same branch with a regression
    test that proves the fix.

## Alternative paths if T-011 isn't the right priority

- **T-010 (MFA enrolment hook + recovery codes)** — bounded scope,
  webhook-driven mirror updates. Good if Brad wants the recovery-
  codes UX contract finalized for the web shell (T-017).
- **T-009 (invitations)** — multi-write flow (creates an
  `invitations` row + sometimes an `external_access_grants`
  row). Should land AFTER the multi-write transaction follow-up
  is wired (see "Pending follow-ups" below).
- **T-019 (GDPR hard-delete)** — multi-write (scrubPii + audit),
  similar transaction concern as T-009.
- **T-016 (webhook handler routing)** — best AFTER T-009 / T-010 /
  T-011 / T-019 land, since it routes events to all of them.

## Pending follow-ups (not blocking, but worth doing soon)

1. **Multi-write transaction wrapping** — `application/signup.ts`
   today does three writes (user / org / membership) outside any
   transaction. If membership-insert fails, we orphan an org. The
   T-007 repos accept a `Db`; they need to also accept a
   `PgTransaction` so callers can wrap sequences in
   `db.transaction(async (tx) => { ... })`. Touches all six repos
   - their integration tests. Bounded scope (~half a day).
     Prerequisite for T-009 (invitations) and T-019 (hard-delete)
     to land cleanly.
2. **`AuthFlowError` generic** — `SignupError`, `LoginError`,
   `SuspensionError` are nearly identical class shells. Could
   extract a generic `AuthFlowError<R extends string>` to
   `application/_errors.ts`. Touches three files for ~10 LOC
   savings — low priority but clean if a future task is in the
   neighbourhood.

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
   doesn't support our Vitest setup.
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
