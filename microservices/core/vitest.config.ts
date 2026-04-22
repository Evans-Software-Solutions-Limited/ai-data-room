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
