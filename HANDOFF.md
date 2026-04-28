# HANDOFF.md

> Ephemeral. Describes what's currently in flight. Refreshed on every
> task transition; delete once steady state ("look at `tasks.md`") is
> safe to assume.

**Last updated:** 2026-04-28 by Claude Code (mid-session, after T-004
merged via PR #4 and T-005 was scaffolded on a new branch).

## Where we are in slice 1 (auth-and-orgs)

| Task   | Status | Notes                                                                                                |
| ------ | ------ | ---------------------------------------------------------------------------------------------------- |
| T-001  | ✅     | Repo scaffold.                                                                                       |
| T-002  | ✅     | WorkOS + secrets wiring (PR #1).                                                                     |
| T-003  | ✅     | Postgres + Drizzle setup, integration test scaffold (PR #3).                                         |
| T-004  | ✅     | Domain types + zod schemas (PR #4).                                                                  |
| T-005  | 🚧     | Drizzle migrations: Postgres-specific DDL. **Branch `feat/auth-and-orgs-T-005-drizzle-migrations`.** |
| T-006… | ⏳     | See `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`.                                               |

## In flight: T-005 — Postgres-specific DDL augments

T-003 absorbed the first migration (`0000_init_auth_and_orgs.sql`).
T-005 lands the bits drizzle-kit can't emit cleanly:

- **`packages/db/src/schema/auth.ts`** — adds a `citext` column type via
  `customType`, retypes `users.email` and `invitations.email` to
  `citext`, and adds two partial unique indexes via
  `uniqueIndex().where(sql\`...\`)`:
  - `org_memberships(org_id) WHERE role = 'owner'` — single-owner-per-
    org (FR1).
  - `users(email) WHERE lifecycle_state <> 'deleted'` — email
    uniqueness that excludes GDPR-tombstoned users (NFR9).
- **`packages/db/migrations/0001_postgres_specific_constraints.sql`** —
  drizzle-generated then hand-edited to prepend
  `CREATE EXTENSION IF NOT EXISTS "citext"` (drizzle-kit doesn't emit
  extension-creation statements). The auto-generated noun-pair filename
  was renamed to a slice/intent-bearing slug; the matching `tag` in
  `meta/_journal.json` was updated to keep the migrator happy.
- **`packages/db/migrations/0001_postgres_specific_constraints.down.sql`**
  — manual reverse migration. Not in the migrations folder drizzle
  reads — opt-in human-driven only. `psql -f`, then delete the
  bookkeeping row.
- **`packages/db/migrations/README.md`** — documents the
  rename-from-drizzle-auto-name convention.
- **`packages/db/test/integration/happy-path.integration.test.ts`** —
  new integration suite. 7 tests: one happy-path insert+read per table,
  plus three tests asserting the T-005-specific invariants:
  1. citext on `users.email` rejects case-insensitive duplicates among
     active rows.
  2. The partial-on-deletion predicate allows reusing a previously-
     deleted email address.
  3. Single-owner-per-org rejects a second `owner` insert but admits
     more `admin` / `internal` rows.

### Guard set status (last run on this branch)

```
bun run typecheck      ✅
bun run test           ✅ — unit suites unchanged
bun run db:check       ✅ — schema in sync with migrations/
bun run db:test:integration ✅ — 11 tests (4 smoke + 7 new), all green
bun run lint           ✅
bun run prettier:check ✅
```

`sst diff` not run for T-005 — no infra changes on this branch.

### What you need to do to ship T-005

1. **Stage + commit.** Suggested shape:
   ```
   feat(auth-and-orgs): T-005 — Postgres-specific DDL + integration tests
   ```
2. **Push** `feat/auth-and-orgs-T-005-drizzle-migrations`, open PR with
   matching `feat(auth-and-orgs): T-005 ...` title.
3. **Watch CI.** Six jobs will run including db-checks (drift) and
   db-integration (smoke + new happy-path), since this PR touches
   `packages/db/**`. CI uses a GitHub Actions native `services:`
   Postgres container — same shape as local docker-compose.
4. **Tick T-005 `[x]`** in `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`
   after merge (currently `[~]` for in-PR-review). Delete merged branch
   locally + remote.

## After T-005 merges → T-006

T-006 is the **WorkOS client wrapper** (T-007 / repository tests need
both T-005 and T-006). Branch off main:

```bash
git checkout main && git pull
git checkout -b feat/auth-and-orgs-T-006-workos-client-wrapper
```

Scope from `tasks.md`:

- Thin wrapper over `@workos-inc/node` exposing only the operations
  actually needed: `userManagement.getAuthorizationUrl`,
  `authenticateWithCode`, `getUser`, `deleteUser`, `createInvitation`,
  `revokeInvitation`, `sendPasswordResetEmail`, `revokeSession`.
- Webhook signature verification helper.
- Vitest unit tests with mocked `@workos-inc/node` + real signature
  verification against a known-good fixture.

Lives at `microservices/core/src/infrastructure/workos/{client,webhook}.ts`.

## Sticky knowledge — kept across handoffs

1. **Drizzle 0.30+ moved bookkeeping into a `drizzle` schema.** Reset
   logic must drop both `public` and `drizzle` (or truncate
   `drizzle.__drizzle_migrations`).
2. **SST component-name typos only surface at deploy time** (`sst.aws.*`
   is `any` in the ambient shim). Always `bun sst diff --stage <dev>`
   before pushing infra changes.
3. **Don't pre-declare future-slice secrets.** SST refuses to deploy
   if any declared secret is unset.
4. **Local docker-compose is `ai-data-room-test-db`-prefixed** to avoid
   colliding with FDP's compose stack. Used by `db:test:integration`.
5. **`bun run test`, not `bun test`.** Bun's built-in runner doesn't
   support our Vitest setup.
6. **`.claude/` is gitignored + prettier-ignored.** First-run agents
   don't need to do anything special.
7. **Migration naming**: drizzle-kit emits `0001_<random_nouns>.sql`;
   we rename to `0001_<intent>.sql` and update the `tag` in
   `meta/_journal.json` (snapshot is keyed by index, so leave it
   alone). `migrations/README.md` documents the convention.
8. **Hand-edited migrations** — drizzle-kit can't emit `CREATE
EXTENSION` or other Postgres-only DDL; pair every hand-touched
   `*.sql` with a `*.down.sql` (kept outside the migrations folder
   drizzle reads, run manually for rollback).
