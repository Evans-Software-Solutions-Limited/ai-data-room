import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: [
        "src/application/**/*.ts",
        "src/**/repositories/*.ts",
        "src/types/**/*.ts",
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
