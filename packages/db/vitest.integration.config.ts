import { defineConfig } from "vitest/config";

// Integration suite. Spins up a Postgres testcontainer per file, applies
// the committed migrations against it, and asserts schema-level
// invariants. Requires a running docker daemon — locally and in CI. The
// PR-checks workflow gates this behind the `db` path filter so web-only
// PRs aren't paying the container start-up cost.
//
// Coverage is intentionally NOT measured here — these tests assert that
// the migration wiring works end-to-end, not that any TS branch is
// reached. The unit suite (vitest.config.ts) owns the 90% gate.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/integration/**/*.test.ts"],
    // Container start-up + migrate is slow; give each test plenty of room
    // before vitest forces a timeout.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One container per test file is enough; running them in parallel
    // would multiply RAM + Docker socket pressure for no real benefit at
    // current size.
    fileParallelism: false,
  },
});
