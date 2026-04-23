import { defineConfig } from "vitest/config";

// Integration suite. Talks to a real Postgres — locally via
// `docker compose -f packages/db/test/integration/docker-compose.yml
// up -d`, in CI via the `db-integration` workflow's
// `services: postgres:` block. See `test/integration/README.md` for
// the full devx walkthrough.
//
// Coverage is intentionally NOT measured here — these tests assert
// that migration wiring works end-to-end, not that any TS branch is
// reached. The unit suite (vitest.config.ts) owns the 90% gate.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/**/*.integration.test.ts"],
    // Migration apply + container readiness can be slow on cold runs;
    // mirror FDP's 60s test / 30s hook budget.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // One file at a time keeps the truncate-between-tests pattern
    // safe even if a future test file forgets `beforeEach`.
    fileParallelism: false,
  },
});
