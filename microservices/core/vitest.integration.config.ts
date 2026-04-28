import { defineConfig } from "vitest/config";

// Integration suite for the core service. Talks to a real Postgres —
// locally via the `packages/db/test/integration/docker-compose.yml`
// stack, in CI via the `core-integration` workflow's `services:`
// block. Reuses the migration + truncate helpers exported from
// `@ai-data-room/db/test/integration/setup` so we don't duplicate
// the pool / migrate / truncate plumbing across workspaces.
//
// Coverage is intentionally NOT measured here — the unit suite
// (vitest.config.ts) already covers each repo's TS branches with
// the 90 % gate. These tests assert that drizzle queries produce the
// shape the application layer depends on; once that's true, every
// branch is reached through normal ts-coverage of the unit tests
// that double-check the same surface.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/integration/**/*.integration.test.ts"],
    // Migration apply on a cold runner can take seconds; mirror FDP's
    // 60 s test / 30 s hook budget.
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // One file at a time keeps the truncate-between-tests pattern
    // safe even if a future test forgets `beforeEach`.
    fileParallelism: false,
  },
});
