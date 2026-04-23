# Integration tests — `@ai-data-room/db`

Mirrors the pattern in `funds-distribution-platform`'s
`microservices/core/test/integration/`.

## What lives here

- `docker-compose.yml` — Postgres 16 + Adminer for local development
  and CI parity. Runs on port 5433 (Postgres) and 8081 (Adminer) so it
  doesn't clash with anything you already have on the standard ports.
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
```

To inspect the DB while it's running, open <http://localhost:8081>:

- System: PostgreSQL
- Server: `postgres`
- User / Password / Database: `ai_data_room` / `ai_data_room` /
  `ai_data_room_test`

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
