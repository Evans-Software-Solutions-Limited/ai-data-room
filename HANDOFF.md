# HANDOFF.md

> Ephemeral. This file describes what's currently in flight on this
> repo. After PR #2 merges and T-004 starts, the next agent should
> rewrite this from the perspective of T-004's in-flight state — or
> delete it once the steady state is "look at `tasks.md`."

**Last updated:** 2026-04-27 by Cowork session (the previous primary
operator). This is the handoff to the first Claude Code agent
picking up the work locally.

## Where we are in the slice 1 (auth-and-orgs) execution

| Task   | Status | Notes                                                                                                      |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------- |
| T-001  | ✅     | Repo scaffolded from `sst-monorepo-template`. PR merged.                                                   |
| T-002  | ✅     | WorkOS + secrets wiring. PR #1 merged.                                                                     |
| T-003  | 🚧     | Postgres + Drizzle setup. **PR #2 OPEN on branch `feat/auth-and-orgs-T-003-postgres-drizzle`.** See below. |
| T-004  | ⏳     | Domain layer types + zod schemas. Not started. Branches off `main` _after_ T-003 merges.                   |
| T-005… | ⏳     | See `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md` for the full list (T-001 through T-019 in slice 1).  |

## In flight: PR #2 — `feat/auth-and-orgs-T-003-postgres-drizzle`

Four commits sit on the branch ahead of `origin/main`:

1. `feat(auth-and-orgs): T-003 — Postgres + drizzle setup` — secret +
   binding, first auth migration generated, drift-check script + CI
   job, original (testcontainers) integration test.
2. `test(db): mirror FDP integration test pattern (drop testcontainers)`
   — switches to docker-compose + GitHub Actions native `services:`
   block, with shared `setup.ts` helpers (`getTestPool`,
   `applyMigrations`, `truncateAllTables`, `destroyTestPool`). Drops
   `@testcontainers/postgresql` + `testcontainers` deps.
3. `chore(db): scope local test stack with ai-data-room-test-* names`
   — adds `name:` + `container_name:` to docker-compose so the stack
   doesn't collide with FDP's compose (both auto-derived
   `integration` as the project name otherwise).
4. `fix(db): drop drizzle bookkeeping schema in rollback smoke test`
   — drizzle-orm 0.30+ keeps `__drizzle_migrations` in a separate
   `drizzle` schema; the rollback test now drops both `public` and
   `drizzle` so the re-apply isn't a no-op. CI was failing on this.
   Also silences NOTICE log spam via `onnotice: () => {}`.

A fifth commit will land on this branch from this Cowork session
covering the AGENTS.md / CLAUDE.md / spec sync / HANDOFF.md import
(this file). After that, **the Cowork session is done with this
repo**; you (Claude Code) own it.

### What you need to do to ship PR #2

1. **Refresh the lockfile.** The branch removed
   `@testcontainers/postgresql` and `testcontainers`, but `bun.lock`
   wasn't regenerated in the Cowork sandbox. Run:
   ```bash
   bun install
   git add bun.lock bun.lockb
   git commit -m "chore: refresh lockfile after dropping testcontainers"
   ```
2. **Validate the integration test locally** before pushing — CI was
   already burned once by the rollback test. Run:
   ```bash
   docker compose -f packages/db/test/integration/docker-compose.yml up -d
   bun run db:test:integration
   ```
   Expect 4 tests pass. If anything fails, fix on this branch — don't
   push a known-broken PR again.
3. **Run the full guard set:**
   ```bash
   bun run typecheck && bun run test && bun run lint && bun run prettier:check
   ```
4. **`bun sst diff --stage <your-dev>`** to confirm the new
   `PLANETSCALE_DATABASE_URL` secret + Lambda binding resolves
   cleanly.
5. **Push:** `git push -u origin feat/auth-and-orgs-T-003-postgres-drizzle`.
6. **Watch CI on PR #2.** Six jobs:
   `typecheck-lint-prettier`, `build`, `unit-tests`, `db-checks`
   (drift), `db-integration` (smoke test against the GHA service
   container), and any others wired up. All must be green.
7. **Merge PR #2** once green. The PR description documents the
   post-merge actions Bradley needs to take to actually use the DB:
   provision the PlanetScale Postgres database for `dev` / `staging`,
   then `bun sst secret set PLANETSCALE_DATABASE_URL <url> --stage
<stage>` per stage. Until those secrets are set, `sst deploy` will
   fail — but typecheck, build, and tests don't need them.

## After PR #2 merges → T-004

T-004 in `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`:

> **Domain layer: types + zod schemas**
> Define domain types and zod schemas (no DB, no IO): `Org`, `User`,
> `OrgMembership`, `ExternalAccessGrant`, `Invitation`, `AuditEvent`,
> `Role`, `LifecycleState`, `AuditEventType` (enum of the 21 values
> from FR24).

Branch from a freshly-pulled `main`:

```bash
git checkout main && git pull
git checkout -b feat/auth-and-orgs-T-004-domain-types-zod
```

T-004's spec is purely files in `microservices/core/domain/{org,user,
invitation,audit}.ts` and `packages/api-utils/schemas/auth-orgs.ts`.
No infra, no DB. Scoped tightly enough to be a one-PR task.

After T-004: T-005 (the migrations augmentation — `citext`, partial
unique indexes Drizzle can't emit), then T-006 onward. See the slice
1 `tasks.md` for the dependency graph.

## Things this Cowork session learned that aren't in any other doc

1. **Drizzle 0.30+ moved its bookkeeping table** out of `public` into
   a dedicated `drizzle` schema. Code that drops `public` to reset
   state will not actually reset Drizzle's view of which migrations
   are applied. Fix: drop both schemas, or `TRUNCATE
drizzle.__drizzle_migrations`.
2. **SST component-name typos only surface at deploy time**, because
   `infra/_sst-globals.d.ts` types `sst.aws.<Component>` as `any`. We
   hit this with `sst.aws.KmsKey` (doesn't exist; use Pulumi's
   `aws.kms.Key` + `sst.Linkable` — see FDP's `infra/kms.ts`). Always
   `bun sst diff` before pushing infra.
3. **Don't pre-declare future-slice secrets.** SST refuses to deploy
   if any declared secret is missing a value. The deferred-secret
   ledger at the bottom of `infra/secrets.ts` is the single source of
   truth for "this secret will be added by slice X T-Y".
4. **The local docker-compose stack is named `ai-data-room-test-db`**
   to avoid colliding with FDP's compose (both auto-derived
   `integration` from the parent dir name). `docker ps --filter
"label=com.docker.compose.project=ai-data-room-test-db"` shows
   only this stack's containers.
5. **`bun run test`, not `bun test`.** Bun's built-in runner doesn't
   support our Vitest setup and silently falls back to a confusing
   error.
