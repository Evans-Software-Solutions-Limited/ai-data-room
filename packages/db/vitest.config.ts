import { defineConfig } from "vitest/config";

// Default config = the **unit** suite. Fast, hermetic, no docker. Runs
// on every PR via `bun run test:unit` and gates the 90% coverage
// guardrail.
//
// Integration tests live under `test/integration/**` (outside `src/`,
// matching FDP's layout) and are excluded from this config — they need
// the local Postgres container started via
// `packages/db/test/integration/docker-compose.yml`. Run them via
// `bun run test:integration` (uses `vitest.integration.config.ts`).
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // The default include only picks up `src/**/*.test.ts`, so tests
    // under `test/integration/` are naturally out of scope. Listing
    // them here as well makes the intent explicit and keeps any
    // accidental future stray test out.
    exclude: ["node_modules", "dist", "test/**"],
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
      // - `test/**` — integration suite, measured nowhere.
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules",
        "**/*.test.ts",
        "**/vitest.config.ts",
        "**/sst-env.d.ts",
        "drizzle.config.ts",
        "migrations/**",
        "src/schema/**",
        "test/**",
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
