import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
import * as path from "path";

// `.env.e2e` if present, else fall back to `.env` (CI sets env vars
// directly and skips both). Playwright runs in Node; Vite's env
// pipeline doesn't apply here.
config({ path: ".env.e2e" });
config();

// `PLAYWRIGHT_BASE_URL` and `VITE_CORE_API_URL` are the only two
// env vars every spec needs. They're set by the GitHub Action's
// "derive URLs from stage" step. Locally, see `docs/runbooks/e2e-stage.md`.
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) {
  throw new Error(
    "PLAYWRIGHT_BASE_URL must be set — see docs/runbooks/e2e-stage.md",
  );
}
if (!process.env.VITE_CORE_API_URL) {
  throw new Error("VITE_CORE_API_URL must be set");
}

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e",
  // CI mode: no retries, fail fast on a single Playwright config
  // mistake; locally allow 1 retry to absorb cold-start flake from
  // the Lambda backing the deployed stage.
  retries: process.env.CI ? 0 : 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  projects: [
    {
      // `storageState` injects the wos_session cookie into every
      // context, so each spec starts pre-authenticated. Specs that
      // need an anonymous context use `test.use({ storageState:
      // emptyStorageState })` (see e2e/helpers/emptyStorageState.ts).
      name: "browser",
      testMatch: "e2e/specs/**/*.spec.ts",
      use: {
        browserName: "chromium",
        headless: process.env.E2E_HEADED !== "true",
        baseURL,
        storageState: path.join(__dirname, ".auth/session.json"),
      },
    },
  ],
});
