# HANDOFF.md

> Ephemeral. Describes what's currently in flight. Refreshed on every
> task transition; delete once steady state ("look at `tasks.md`") is
> safe to assume.

**Last updated:** 2026-04-28 by Claude Code (mid-session, after T-006
merged via PR #6 and T-007 was scaffolded on a new branch).

## Where we are in slice 1 (auth-and-orgs)

| Task   | Status | Notes                                                                                 |
| ------ | ------ | ------------------------------------------------------------------------------------- |
| T-001  | ✅     | Repo scaffold.                                                                        |
| T-002  | ✅     | WorkOS + secrets wiring (PR #1).                                                      |
| T-003  | ✅     | Postgres + Drizzle setup, integration test scaffold (PR #3).                          |
| T-004  | ✅     | Domain types + zod schemas (PR #4).                                                   |
| T-005  | ✅     | Postgres-specific DDL augments (PR #5).                                               |
| T-006  | ✅     | WorkOS client wrapper + webhook verifier (PR #6).                                     |
| T-007  | 🚧     | Typed Drizzle repositories. **Branch `feat/auth-and-orgs-T-007-typed-repositories`.** |
| T-008… | ⏳     | See `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`.                                |

## In flight: T-007 — typed Drizzle repositories

Six repository classes at `microservices/core/src/infrastructure/db/`,
each constructor-injected with a `Db` from `@ai-data-room/db`:

- **`userRepo.ts`** — `create`, `findById`, `findByWorkosUserId`,
  `findByEmail` (citext, case-insensitive), `setLifecycleState`,
  `setMfaEnrolledAt`, `setEmailVerifiedAt`, `scrubPii` (NFR9 hard-
  delete).
- **`orgRepo.ts`** — `create`, `findById`, `findByWorkosOrgId`,
  `findBySlug`.
- **`membershipRepo.ts`** — `create`, `findByOrgUser`, `listByOrg`,
  `findOwnerForOrg` (the FR23 sole-owner check).
- **`externalGrantRepo.ts`** — `create`, `listByUser`, `listByOrg`.
- **`invitationRepo.ts`** — `create`, `findById`,
  `findByWorkosInvitationId`, `listByOrgAndState`, `setState` (auto-
  stamps `acceptedAt` on the accepted state, nulls it otherwise).
- **`auditRepo.ts`** — `write` (append-only), `listByOrg` with
  keyset pagination by `(occurredAt desc, id desc)` and a hard cap
  on limit. No update/delete methods — append-only by convention at
  v0.1, trigger-enforced at SOC 2 entry.

Shared internals:

- `_helpers.ts` — `firstOrNull<T>(rows: T[])` for the
  `(rows[0] as T | undefined) ?? null` pattern that every lookup
  method needs.

Each repo returns the canonical domain types from
`@ai-data-room/api-utils/schemas/auth-orgs` (T-004), not drizzle row
types. The two shapes are aligned by construction — both derive from
design.md §Data model — so a small `as User` cast at the boundary is
the cleanest way to express the contract. The application layer stays
free of any drizzle-orm import.

### Tests

31 integration tests at `microservices/core/test/integration/db/*.integration.test.ts`,
one per public repo method. They use:

- `@ai-data-room/db/test/integration/setup` — pool / migrate / truncate
  helpers shared with the existing T-003 + T-005 suites. The setup
  module is now a public package export
  (`packages/db/package.json` → `./test/integration/setup`).
- `microservices/core/test/integration/db/fixtures.ts` — the
  `seedOrgAndUser` helper used by membership / grant / invitation /
  audit tests, plus `seedAuditEvents` for batch-inserting events with
  explicit `occurredAt` timestamps (replaces a prior `setTimeout(r, 2)`
  loop in the audit pagination test).

The membership test exercises the T-005 single-owner partial unique
end-to-end. The user test exercises citext via case-insensitive
findByEmail.

### CI wiring

A new `core-integration` job in `.github/workflows/pr-checks.yml`
mirrors the existing `db-integration` shape: own Postgres 16 service
container, gated on `core || db` changes (db schema changes need to
re-run the repo suite). Two parallel jobs cost two containers but
keep failure attribution tight per workspace.

### Guard set status (last run on this branch)

```
bun run typecheck                 ✅
bun run test                      ✅ — unit suites unchanged
bun run db:check                  ✅ — schema in sync (no schema delta)
bun run db:test:integration       ✅ — 11 tests (T-003 + T-005 suites)
bun run core:test:integration     ✅ — 31 tests (T-007 suite)
bun run lint                      ✅
bun run prettier:check            ✅
```

`sst diff` not run for T-007 — no infra changes on this branch.

### What you need to do to ship T-007

1. **Stage + commit.** Suggested:
   ```
   feat(auth-and-orgs): T-007 — typed Drizzle repositories + integration suite
   ```
2. **Push** `feat/auth-and-orgs-T-007-typed-repositories`, open PR
   with matching title.
3. **Watch CI.** Seven jobs will run including the new
   `core-integration` (and the existing `db-integration` skips since
   `packages/db/**` is untouched on this branch — only the package
   export, which counts as a `db` change actually, so DB jobs may
   fire too; verify on first push).
4. **Tick T-007 `[x]`** in `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`
   after merge (currently `[~]`). Delete the branch locally + remote.

## After T-007 merges → T-008+ fan-out

Per the dependency graph in `tasks.md`, T-007 unblocks the entire
parallelisable application-layer fan-out:

- **T-008** signup + callback flow (depends on T-006 + T-007).
- **T-009** invitations.
- **T-010** MFA enrolment hook + recovery codes.
- **T-011** password reset.
- **T-012** suspension lifecycle.
- **T-013** audit event writer.
- **T-016** WorkOS webhook handler.

These can run in parallel — fan out to multiple Claude Code sessions
or pick them up sequentially as one operator. The CLAUDE.md
"one-task-one-PR" rule still holds.

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
   avoid colliding with FDP's compose stack. Used by both
   `db:test:integration` and the new `core:test:integration`.
5. **`bun run test`, not `bun test`.** Bun's built-in runner doesn't
   support our Vitest setup.
6. **`.claude/` is gitignored + prettier-ignored.**
7. **Migration naming**: drizzle-kit emits `0001_<random_nouns>.sql`;
   we rename to `0001_<intent>.sql` and update the `tag` in
   `meta/_journal.json`.
8. **Hand-edited migrations** — pair every hand-touched `*.sql` with
   a `*.down.sql` (kept outside the migrations folder drizzle reads,
   run manually for rollback).
9. **WorkOS SDK names** — `userManagement.sendInvitation` (not
   `createInvitation`), `userManagement.createPasswordReset` (no
   `sendPasswordResetEmail` method). The wrapper at
   `infrastructure/workos/client.ts` bridges them.
10. **WorkOS webhooks need a synthetic clientId** — `new WorkOS({})`
    throws; PKCE-mode `new WorkOS({ clientId: ... })` is the
    workaround for signature-verification-only paths.
11. **Repos use `firstOrNull` for "select-one or null"** — added in
    T-007 (`infrastructure/db/_helpers.ts`). Drizzle has no `.first()`
    shorthand so we collapse the boilerplate ourselves.
12. **Integration tests run in two suites** — `db:test:integration`
    (migration smoke + happy-path inserts) covers the schema layer;
    `core:test:integration` covers the repo classes. Both reuse
    `packages/db/test/integration/setup.ts`. CI runs them as two
    parallel jobs sharing nothing but the Postgres major version.
