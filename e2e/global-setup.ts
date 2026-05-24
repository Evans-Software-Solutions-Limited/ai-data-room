import { request } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Runs once before any spec. Hits the deployed stage's
// `/e2e/auth/login` bootstrap (see `application/auth/e2e-bootstrap/
// postE2EAuthLoginHandler.ts`), captures the `wos_session` cookie
// the backend set, and writes the Playwright `storageState` blob to
// `.auth/session.json` so every browser context starts authenticated.
//
// All env vars are required — global setup throws clearly rather
// than letting individual specs blow up on a missing piece.

export default async function globalSetup() {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  const e2eSecret = process.env.E2E_AUTH_SECRET;
  const apiURL = process.env.VITE_CORE_API_URL;

  if (!email || !password) {
    throw new Error(
      "E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set in .env.e2e — " +
        "see docs/runbooks/e2e-stage.md",
    );
  }
  if (!e2eSecret) {
    throw new Error(
      "E2E_AUTH_SECRET must be set — see docs/runbooks/e2e-stage.md",
    );
  }
  if (!apiURL) {
    throw new Error("VITE_CORE_API_URL must be set");
  }

  const requestContext = await request.newContext({ baseURL: apiURL });

  const response = await requestContext.post("/e2e/auth/login", {
    headers: { "x-e2e-key": e2eSecret },
    data: { email, password },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(
      `[global-setup] /e2e/auth/login failed: ${response.status()} ${body}`,
    );
  }

  const sessionPath = path.join(__dirname, "../.auth/session.json");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  await requestContext.storageState({ path: sessionPath });
  await requestContext.dispose();

  console.log("[global-setup] session saved to .auth/session.json");
}
