import * as fs from "fs";
import * as path from "path";

// Reads the sealed `wos_session` blob that global-setup wrote to
// `.auth/session.json`. Specs that need to make raw API requests
// (rather than driving the SPA) use this to mint a Cookie header
// without rerunning the bootstrap flow.

export function getRealSessionCookie(): string {
  const sessionPath = path.join(__dirname, "../../.auth/session.json");

  if (!fs.existsSync(sessionPath)) {
    throw new Error(
      `.auth/session.json not found — run global-setup first via \`bunx playwright test\``,
    );
  }

  const state: { cookies: Array<{ name: string; value: string }> } = JSON.parse(
    fs.readFileSync(sessionPath, "utf-8"),
  );
  const cookie = state.cookies.find((c) => c.name === "wos_session");
  if (!cookie) {
    throw new Error(
      `wos_session missing from .auth/session.json — try \`rm .auth/session.json && bunx playwright test\``,
    );
  }
  return cookie.value;
}

export function getApiUrl(): string {
  const url = process.env.VITE_CORE_API_URL;
  if (!url) throw new Error("VITE_CORE_API_URL is not set");
  return url.replace(/\/$/, "");
}
