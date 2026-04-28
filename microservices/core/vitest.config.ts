import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      // Layered architecture (matches FDP + microservices/core/src/README.md):
      // unit-test-cover application/, repositories/, handlers/, infrastructure/
      // and domain/. `src/api.ts` + `src/index.ts` are pure wiring covered by
      // integration/e2e. Type-only files under domain/ get added to `exclude`
      // as they appear (FDP precedent).
      include: [
        "src/application/**/*.ts",
        "src/**/repositories/*.ts",
        "src/handlers/**/*.ts",
        "src/infrastructure/**/*.ts",
        "src/domain/**/*.ts",
      ],
      exclude: [
        "node_modules",
        "**/*.test.ts",
        "**/vitest.config.ts",
        "**/sst-env.d.ts",
        "src/api.ts",
        "src/index.ts",
        // Domain barrels (T-004) — pure `export type` re-exports from
        // `@ai-data-room/api-utils/schemas/auth-orgs`. v8 can't measure
        // coverage on type-only output (it compiles away), so these
        // would skew the gate without exercising any logic. The
        // schemas themselves are covered in the api-utils workspace.
        // FDP precedent: same treatment for `domain/types/*.ts`.
        "src/domain/**/*.ts",
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
