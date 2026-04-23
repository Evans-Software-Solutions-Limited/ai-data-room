import { defineConfig } from "vitest/config";

// Default config = the **unit** suite. Fast, hermetic, no docker. Runs on
// every PR via `bun run test:unit` and gates the 90% coverage guardrail.
//
// Integration tests live under `src/__tests__/integration/**` and are
// excluded from this config — they need a docker daemon to spin up the
// Postgres testcontainer. Run them via `bun run test:integration`
// (uses `vitest.integration.config.ts`). CI runs them on PRs that touch
// `packages/db/**` via the `db-integration` workflow job.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["node_modules", "dist", "**/__tests__/integration/**"],
    coverage: {
      provider: "v8",
      // Coverage covers the runtime slice of the package only:
      // - `src/index.ts` exposes `getDb()` (connection pool wiring).
      // - `src/repos/**` will hold the typed repositories from T-004+.
      // Excluded as non-runtime / declarative:
      // - `src/schema/**` — drizzle schema DSL, declarative tables.
      // - `src/schema/index.ts` barrel.
      // - `drizzle.config.ts` — drizzle-kit CLI config (not shipped).
      // - `migrations/**` — SQL artefacts.
      // - `src/__tests__/integration/**` — exercised only under
      //   testcontainers; not part of the unit-coverage scope.
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules",
        "**/*.test.ts",
        "**/vitest.config.ts",
        "**/sst-env.d.ts",
        "drizzle.config.ts",
        "migrations/**",
        "src/schema/**",
        "src/__tests__/integration/**",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
