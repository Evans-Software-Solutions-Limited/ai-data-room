# Integration tests — `@ai-data-room/db`

Mirrors the pattern in `funds-distribution-platform`'s
`microservices/core/test/integration/`.

## What lives here

- `docker-compose.yml` — Postgres 16 + Adminer for local development
  and CI parity. Project name is `ai-data-room-test-db` and container
  names are `ai-data-room-test-postgres` / `ai-data-room-test-adminer`
  so the stack runs cleanly alongside FDP's compose (which would
  otherwise share the auto-derived `integration` project name). Runs
  on port 5433 (Postgres) and 8081 (Adminer) to avoid clashing with
  any local Postgres install or FDP's own Adminer on 8080.
- `setup.ts` — shared helpers: `getTestPool`, `applyMigrations`,
  `truncateAllTables`, `destroyTestPool`. Test files compose these in
  their own lifecycle hooks; there is no global `setupFiles`.
- `*.integration.test.ts` — the tests themselves. Discovered by
  `vitest.integration.config.ts` (separate from the unit-test config).

## Quick start

```bash
# 1. Start the local Postgres container (one-off; leave it running)
docker compose -f packages/db/test/integration/docker-compose.yml up -d

# 2. Run the integration suite
bun run --filter @ai-data-room/db test:integration
# or, from repo root:
bun run db:test:integration

# 3. Tear down when done (or keep it running for the next session)
docker compose -f packages/db/test/integration/docker-compose.yml down

# Reset state (drop the tmpfs data volume + recreate):
docker compose -f packages/db/test/integration/docker-compose.yml down -v

# Confirm what's running, see project labelling:
docker ps --filter "label=com.docker.compose.project=ai-data-room-test-db"
```

## Inspecting the DB

Two web UIs are available — pick whichever fits the moment:

**Adminer** (lives in this compose, FDP-style general-purpose UI) at
<http://localhost:8081>:

- System: PostgreSQL
- Server: `postgres`
- User / Password / Database: `ai_data_room` / `ai_data_room` /
  `ai_data_room_test`

**Drizzle Studio** (schema-aware, runs separately, hosted at
<https://local.drizzle.studio>):

```bash
DATABASE_URL=postgres://ai_data_room:ai_data_room@localhost:5433/ai_data_room_test \
  bun run db:studio
```

Drizzle Studio understands the schema in `packages/db/src/schema/**`,
so it shows enum dropdowns, FK relationships, and typed inputs.
Adminer is faster for ad-hoc SQL or seeing the raw migration state.

## Connection-string resolution

Tests read `INTEGRATION_DATABASE_URL` from the environment, falling
back to the local container's URI:

```
postgres://ai_data_room:ai_data_room@localhost:5433/ai_data_room_test
```

In CI, the GitHub Actions workflow (`pr-checks.yml#db-integration`)
sets `INTEGRATION_DATABASE_URL` to point at a Postgres service
container that the runner stands up natively (no Docker socket
needed). A future job can override the same env var to run the
integration suite against a live PlanetScale dev branch.

## Test-file lifecycle

Per FDP convention:

```ts
beforeAll(async () => {
  await applyMigrations();
}); // once per file
beforeEach(async () => {
  await truncateAllTables();
}); // hermetic between cases
afterAll(async () => {
  await destroyTestPool();
});
```

`applyMigrations` is idempotent (Drizzle records applied migrations in
`__drizzle_migrations` and skips already-applied ones), so re-running
the suite without restarting the container is safe. Truncation uses
`information_schema` discovery rather than a hard-coded list, so new
tables added in T-005+ are automatically swept.

## Why docker-compose, not testcontainers?

To stay aligned with FDP. A single long-lived container that
developers manage manually keeps test cycles fast (no per-file image
pull / container start), gives an Adminer UI for ad-hoc inspection,
and exactly matches the CI service-container shape so "works locally,
fails in CI" is unlikely.
