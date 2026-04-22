import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
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
      include: ["src/**/*.ts"],
      exclude: [
        "node_modules",
        "**/*.test.ts",
        "**/vitest.config.ts",
        "**/sst-env.d.ts",
        "drizzle.config.ts",
        "migrations/**",
        "src/schema/**",
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
