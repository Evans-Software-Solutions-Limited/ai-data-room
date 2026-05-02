# HANDOFF.md

> Ephemeral. Describes what's currently in flight. Refreshed on every
> task transition; delete once steady state ("look at `tasks.md`") is
> safe to assume.

**Last updated:** 2026-05-01 by Claude Code (T-012 mid-PR; T-008
merged earlier today).

## Where we are in slice 1 (auth-and-orgs)

| Task  | Status | Notes                                                                                                |
| ----- | ------ | ---------------------------------------------------------------------------------------------------- |
| T-001 | ✅     | Repo scaffold.                                                                                       |
| T-002 | ✅     | WorkOS + secrets wiring (PR #1).                                                                     |
| T-003 | ✅     | Postgres + Drizzle setup (PR #3).                                                                    |
| T-004 | ✅     | Domain types + zod schemas (PR #4).                                                                  |
| T-005 | ✅     | Postgres-specific DDL augments (PR #5).                                                              |
| T-006 | ✅     | WorkOS client wrapper + webhook verifier (PR #6).                                                    |
| T-007 | ✅     | Typed Drizzle repositories (PR #7).                                                                  |
| T-013 | ✅     | Application-layer audit event writer (PR #8).                                                        |
| T-008 | ✅     | Signup + login callback flows (PR #9).                                                               |
| T-009 | ⏳     | Application layer: invitations.                                                                      |
| T-010 | ⏳     | Application layer: MFA enrolment hook + recovery codes.                                              |
| T-011 | ⏳     | Application layer: password reset.                                                                   |
| T-012 | 🚧     | Application layer: suspension lifecycle. **Branch `feat/auth-and-orgs-T-012-suspension-lifecycle`.** |
| T-014 | ⏳     | Handlers: HTTP routes (depends on the application-layer fan-out below).                              |
| T-016 | ⏳     | WorkOS webhook handler routing — best landed AFTER T-008/T-009/T-010/T-011/T-012/T-019.              |
| T-019 | ⏳     | GDPR hard-delete.                                                                                    |

## In flight: T-012 — suspension lifecycle

`microservices/core/src/application/suspension.ts` ships
`suspendUser` and `unsuspendUser`. Handlers (T-014) wire to HTTP later.

`suspendUser` enforces FR21–FR23:

- **FR23 self-prevention** — actor cannot suspend themselves.
- **FR23 sole-owner protection** — the (single) owner of an org
  cannot be suspended. The T-005 partial unique guarantees at most
  one owner; if target IS the owner, they're sole by definition.
- **FR21(a) lifecycle flip** — `users.lifecycle_state = 'suspended'`
  via `UserRepo.setLifecycleState`.
- **FR21(b) session termination** — every active WorkOS session is
  revoked via `WorkOSClient.listSessions` + parallel
  `revokeSession`. Revocations complete BEFORE the lifecycle flip
  (the spec's timing-test requirement); a revoke failure leaves our
  DB consistent (target stays `active`).
- **FR21(c) future-login rejection** — handled by `login.ts`
  rejecting non-active users.
- **FR21(d) audit** — `user_suspended` (success or failure with
  reason in metadata).

`unsuspendUser` reverses (a) + (d). WorkOS sessions are NOT
re-touched — the suspension already revoked them; the user has to
re-authenticate.

Authorization (only owner / admin can suspend) is intentionally a
handler-layer concern (T-014). The application function only
enforces data invariants.

The T-006 WorkOS wrapper gained a new operation:
`listSessions(userId): Promise<Session[]>` — auto-paginates the
SDK's `AutoPaginatable` so callers get a flat array. T-011 (password
reset on `password_reset_completed`) will reuse it.

### Tests — 13 unit tests + 1 wrapper test

13 cases at `microservices/core/src/application/__tests__/suspension.test.ts`
(mocked WorkOSClient + repos, real `recordAuditEvent`):

- **Happy path** (2): full flow with active + expired sessions
  filtered correctly, success with zero revocations.
- **FR21(b) timing** (2): `mock.invocationCallOrder` asserts every
  `revokeSession` call precedes `setLifecycleState` (the timing
  test the spec calls out); revoke-failure does not flip lifecycle.
- **FR23 self-suspension** (2): throws + emits failure audit.
- **FR23 sole-owner protection** (2): rejects when target is the
  org's only owner; permits otherwise.
- **`user_not_found`** (1): rejects + audits.
- **`unsuspendUser`** (3): success, no session-revoke, missing
  target throws + audits.

One new test in `infrastructure/workos/__tests__/client.test.ts`
covers the `listSessions` auto-paginate behavior.

Workspace coverage: 100 / 98.05 / 100 / 100 (gate 90 %).
`suspension.ts`, `client.ts` both at 100 % all-around.

### Guard set status (last run on this branch)

```
bun run typecheck                 ✅
bun run test                      ✅ — 92 unit tests in core (T-012 adds 14)
bun run lint                      ✅
bun run prettier:check            ✅
```

`sst diff` not run for T-012 — no infra changes on this branch.

### What you need to do to ship T-012

1. Stage + commit. Suggested:
   ```
   feat(auth-and-orgs): T-012 — suspension lifecycle + WorkOS listSessions
   ```
2. Push and open PR.
3. Watch CI: 6 active jobs (db-\* skip — no `packages/db/**` delta;
   core-integration runs the T-007 repo suite again because
   `microservices/core/**` changed).
4. Tick T-012 `[x]` in `.kiro/specs/.../tasks.md` after merge.

## After T-012 merges → continue the application-layer fan-out

Same parallelisable set, minus T-012:

- **T-009** invitations — multi-write flow (will benefit from the
  transaction follow-up flagged in T-008).
- **T-010** MFA enrolment hook + recovery codes.
- **T-011** password reset — can reuse the new
  `WorkOSClient.listSessions` (revoke-all-on-reset).
- **T-019** GDPR hard-delete — multi-write (same transaction
  follow-up applies).
- **T-016** WorkOS webhook handler routing — best last.

## Sticky knowledge — kept across handoffs

1. **Drizzle 0.30+ moved bookkeeping into a `drizzle` schema.** Reset
   logic must drop both `public` and `drizzle` (or truncate
   `drizzle.__drizzle_migrations`).
2. **SST component-name typos only surface at deploy time** (`sst.aws.*`
   is `any` in the ambient shim). Always `bun sst diff --stage <dev>`
   before pushing infra changes.
3. **Don't pre-declare future-slice secrets.** SST refuses to deploy
   if any declared secret is unset.
4. **Local docker-compose is `ai-data-room-test-db`-prefixed** to
   avoid colliding with FDP's compose stack.
5. **`bun run test`, not `bun test`.** Bun's built-in runner doesn't
   support our Vitest setup.
6. **`.claude/` is gitignored + prettier-ignored.**
7. **Migration naming**: drizzle-kit emits `0001_<random_nouns>.sql`;
   we rename to `0001_<intent>.sql` and update the `tag` in
   `meta/_journal.json`.
8. **Hand-edited migrations** — pair every hand-touched `*.sql` with
   a `*.down.sql` outside the migrations folder drizzle reads.
9. **WorkOS SDK names** — `userManagement.sendInvitation` (not
   `createInvitation`), `userManagement.createPasswordReset` (no
   `sendPasswordResetEmail` method). The wrapper at
   `infrastructure/workos/client.ts` bridges them.
10. **WorkOS webhooks need a synthetic clientId** — `new WorkOS({})`
    throws; PKCE-mode `new WorkOS({ clientId: ... })` is the
    workaround for signature-verification-only paths.
11. **Repos use `firstOrNull` for "select-one or null" and
    `firstOrThrow` for "update-must-find-row"** —
    `_helpers.ts` is the single home.
12. **AuditRepo cursor is composite `(occurredAt, id) < (cursor)`** —
    the id half is load-bearing for events sharing a millisecond.
13. **All audit writes go through `application/audit.ts#recordAuditEvent`**,
    never `AuditRepo.write` directly.
14. **`safeAudit` in `application/_audit-context.ts`** — every
    application-layer auth flow uses this to emit audits without
    letting an audit-write failure mask the real outcome.
15. **MFA-presence check is pluggable via `deps.isMfaPresent`** —
    default trusts AuthKit; T-010 will swap in a stricter check
    once `listAuthFactors` is added to the WorkOS wrapper.
16. **Multi-write transactions are NOT yet wired in any application
    function.** Signup orphans an org if membershipCreate fails;
    same risk for any future flow with >1 write. Follow-up that
    expands T-007 repos to accept `Db | PgTransaction` is queued.
17. **Login resolves WorkOS org id → local UUID via
    `orgRepo.findByWorkosOrgId`** — `session.organizationId` is the
    WorkOS-side text id, NOT our local UUID. Passing it directly to
    `findByOrgUser` would either throw "invalid uuid syntax" or
    silently miss every membership.
18. **Signup stamps `mfaEnrolledAt` + `emailVerifiedAt` at create-time**
    (T-007's `CreateUserInput` was extended). Without this, fresh
    signups would fail their first login on the FR16 MFA gate
    until the (not-yet-built) T-010 webhook backfills.
19. **Suspension revokes WorkOS sessions BEFORE flipping local
    lifecycle.** A revoke failure leaves our DB consistent — better
    than the opposite (DB says "suspended" but sessions still
    alive). The spec's "timing test" asserts this ordering via
    `mock.invocationCallOrder`.
20. **`WorkOSClient.listSessions(userId)` auto-paginates** — T-011
    (password reset on completion) will reuse the same flat-array
    return shape.
