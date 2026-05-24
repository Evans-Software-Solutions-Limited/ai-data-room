// AC-US7 — a logged-in user stays logged in across page reloads
// and across a fresh browser context within the inactivity window.
// (External-user 24h hard cap is a backend concern verified by
// `requireAuth.test`'s refresh path — not browser-observable.)

import { expect, test } from "@playwright/test";

test.describe("AC-US7 — session persists across reload + new context", () => {
  test("a full-page reload preserves the authenticated state", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page.getByRole("status", { name: /loading/i })).toBeHidden({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: /sign out/i })).toBeVisible();

    // A bare `page.reload()` rebuilds the DOM but keeps the cookie
    // jar — verifies the cookie is durable, not just memo-cached.
    await page.reload();
    await expect(page.getByRole("status", { name: /loading/i })).toBeHidden({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: /sign out/i })).toBeVisible();
  });

  test("a fresh context with the same storageState lands authenticated", async ({
    browser,
  }) => {
    // Playwright creates a brand new BrowserContext (separate cookie
    // jar, cache, storage) but seeded from the same `storageState`
    // file. Equivalent to closing the browser and reopening it
    // within the inactivity window — the AC-US7 invariant we care
    // about.
    const fresh = await browser.newContext({
      storageState: ".auth/session.json",
    });
    const page = await fresh.newPage();
    await page.goto(process.env.PLAYWRIGHT_BASE_URL! + "/app");
    await expect(page.getByRole("status", { name: /loading/i })).toBeHidden({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: /sign out/i })).toBeVisible();
    await fresh.close();
  });
});
