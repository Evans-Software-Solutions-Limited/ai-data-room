# HANDOFF.md

> Ephemeral. Describes what's currently in flight. Refreshed on every
> task transition; delete once steady state ("look at `tasks.md`") is
> safe to assume.

**Last updated:** 2026-04-30 by Claude Code (T-008 mid-PR; possibly
running concurrently with a parallel agent on a different
application-layer task — see "Parallel-PR window" below).

## Where we are in slice 1 (auth-and-orgs)

| Task   | Status    | Notes                                                                                                   |
| ------ | --------- | ------------------------------------------------------------------------------------------------------- |
| T-001  | ✅        | Repo scaffold.                                                                                          |
| T-002  | ✅        | WorkOS + secrets wiring (PR #1).                                                                        |
| T-003  | ✅        | Postgres + Drizzle setup (PR #3).                                                                       |
| T-004  | ✅        | Domain types + zod schemas (PR #4).                                                                     |
| T-005  | ✅        | Postgres-specific DDL augments (PR #5).                                                                 |
| T-006  | ✅        | WorkOS client wrapper + webhook verifier (PR #6).                                                       |
| T-007  | ✅        | Typed Drizzle repositories (PR #7).                                                                     |
| T-013  | ✅        | Application-layer audit event writer (PR #8).                                                           |
| T-008  | 🚧        | Application layer: signup + callback flow. **Branch `feat/auth-and-orgs-T-008-signup-login-callback`.** |
| T-009… | ⏳ / 🚧\* | T-009 / T-010 / T-011 / T-012 / T-016 / T-019 — parallelisable. \*One may also be in flight.            |

## Parallel-PR window — coordination notes

T-007 + T-013 unblocked the entire application-layer fan-out
(T-008 / T-009 / T-010 / T-011 / T-012 / T-016 / T-019). With several
branches potentially mid-flight at once, a few coordination rules:

- **Each PR owns its own `application/<task>.ts` file** — zero file
  overlap between application-layer PRs. Conflict surface: the
  shared `_audit-context.ts` (T-008 added it; future tasks should
  treat it as read-only and import).
- **`HANDOFF.md` ownership** — only the most-recently-started branch
  refreshes this file. Other parallel branches leave it alone and
  carry their state in the PR description. Whichever PR merges last
  refreshes `HANDOFF.md` to point at the next active branch.
- **`tasks.md` ticks** — each PR ticks its own task `[~]` / `[x]`.
  Parallel branches won't conflict if they tick different lines.

## In flight: T-008 — signup + callback flow

`microservices/core/src/application/signup.ts` and `login.ts` ship
the application-layer entry points behind the WorkOS auth callback.
Handlers (T-014) wire these to HTTP later.

`signup.ts#handleSignup`:

1. Exchange WorkOS code via `workos.authenticateWithCode`.
2. Sanity-check MFA via a pluggable `isMfaPresent` predicate
   (default: trust AuthKit; T-010 can swap in a stricter
   `listAuthFactors`-backed check).
3. Create `users` row mirroring the WorkOS user.
4. Create `organizations` row using the form-supplied name + slug.
   `workosOrgId` mirrors `session.organizationId` if AuthKit
   attached one; otherwise falls back to `synth_<uuid>` so a
   re-signup of a previously-deleted user doesn't collide on the
   unique index.
5. Create the owner `org_memberships` row.
6. Audit `signup` event (success or failure).

`login.ts#handleLoginCallback`:

1. Exchange WorkOS code.
2. Look up local user by `workos_user_id`. Reject `user_not_found`
   if missing.
3. Reject `user_suspended` if `lifecycleState !== 'active'`
   (FR21(c)).
4. Reject `mfa_required` if pluggable predicate says no, or local
   `mfaEnrolledAt` is null.
5. Resolve org membership for context (null for external users).
6. Audit `login_success` or `login_failure` (with `reason` in
   metadata).

Both flows use a shared `_audit-context.ts` helper (`safeAudit` —
swallows `recordAuditEvent` errors so a failed audit write doesn't
mask the real outcome; the dropped event is detectable via the
`auth.audit.write_failure` metric T-018 will add).

### Tests

19 unit tests at `microservices/core/src/application/__tests__/{signup,login}.test.ts`:

- **Signup** (9): happy path, synth-orgId format, synth-orgId
  uniqueness across re-signups, fullName composition (both halves
  / first-only / null), MFA-rejected throw + audit + skip-writes,
  audit-write failure doesn't mask success.
- **Login** (10): returning-login happy path, null-membership
  external path, no-organizationId path, user-not-found / suspended
  / deleted / MFA-missing rejections (each with login_failure
  audit), audit-write failure doesn't mask result.

Workspace coverage: 100 / 97.56 / 100 / 100 (gate 90 %).

### Known follow-up flagged in this PR

`handleSignup` does **user → org → membership** as three sequential
non-transactional writes. If `membershipRepo.create` fails after
user + org are persisted, we leave an orphaned org with no owner.
The fix is a small T-007 refactor — repos need to accept
`Db | PgTransaction` so application functions can call
`deps.db.transaction(async tx => …)` and instantiate
transaction-scoped repos. Tracked for the multi-write follow-up
that also covers T-009 (membership + grant insert pair) and T-019
(scrub + audit pair). PR description has a checkbox.

### Guard set status (last run on this branch)

```
bun run typecheck                 ✅
bun run test                      ✅ — 74 unit tests in core (T-008 adds 19)
bun run lint                      ✅
bun run prettier:check            ✅
```

`sst diff` not run for T-008 — no infra changes on this branch.

### What you need to do to ship T-008

1. Stage + commit. Suggested:
   ```
   feat(auth-and-orgs): T-008 — signup + login callback flows
   ```
2. Push and open PR.
3. Watch CI: 6 active jobs (db-\* skip — no `packages/db/**` delta;
   core-integration runs the T-007 repo suite again because
   `microservices/core/**` changed).
4. Tick T-008 `[x]` in `.kiro/specs/.../tasks.md` after merge.

## After T-008 merges → continue the application-layer fan-out

Same parallelisable set as before T-008:

- **T-009** invitations (depends on T-006 + T-007 + T-013).
- **T-010** MFA enrolment hook + recovery codes.
- **T-011** password reset.
- **T-012** suspension lifecycle.
- **T-016** WorkOS webhook handler routing — best landed AFTER
  T-008/T-009/T-010/T-011/T-012/T-019 since it routes to them.
- **T-019** GDPR hard-delete.

Multi-write transaction follow-up (see "Known follow-up" above) is
worth doing before T-009 / T-019 merge, so they pick up the
transactional repo type.

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
    letting an audit-write failure mask the real outcome. New
    flows (T-009 / T-010 / T-011 / T-012 / T-019) should reuse it.
15. **MFA-presence check is pluggable via `deps.isMfaPresent`** —
    default trusts AuthKit; T-010 will swap in a stricter check
    once `listAuthFactors` is added to the WorkOS wrapper.
16. **Multi-write transactions are NOT yet wired in any application
    function.** Signup orphans an org if membershipCreate fails;
    same risk for any future flow with >1 write. Follow-up that
    expands T-007 repos to accept `Db | PgTransaction` is queued.
