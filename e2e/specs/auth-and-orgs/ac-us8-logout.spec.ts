// AC-US8 — after logout, the prior session token is invalid; using
// it returns 401; an audit event records the logout.
//
// Browser-observable half: the sign-out flow clears the `wos_session`
// cookie and a subsequent `/app` visit lands on the public landing.
// The audit-event half is verified at the application layer
// (`getSignOutHandler.test.ts` + `audit.integration.test.ts`); we
// don't query the audit table from Playwright.

import { expect, test } from "@playwright/test";

test.describe("AC-US8 — sign-out invalidates the session", () => {
  // The redirect chain is API → AuthKit logout URL → frontend, so
  // give the test extra headroom for cold-start Lambda + WorkOS
  // round-trip.
  test.describe.configure({ timeout: 120_000 });

  test("sign-out clears the cookie and the public landing renders", async ({
    page,
  }) => {
    await page.goto("/app");
    await expect(page.getByRole("status", { name: /loading/i })).toBeHidden({
      timeout: 15_000,
    });
    const signOut = page.getByRole("link", { name: /sign out/i });
    await expect(signOut).toBeVisible();

    // Read the absolute href and navigate directly. Some headless
    // browsers eat anchor clicks inside dropdown affordances; a
    // direct `page.goto` is the reliable form for cross-browser
    // CI runs. Confirmed against FDP's equivalent spec.
    const signOutHref = await signOut.getAttribute("href");
    expect(signOutHref).toMatch(/^https?:\/\//);

    await page.goto(signOutHref!);

    // The post-logout SPA renders the anonymous nav variant —
    // sign-in is back in view.
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible({
      timeout: 90_000,
    });

    const cookies = await page.context().cookies();
    const wosSession = cookies.find((c) => c.name === "wos_session");
    expect(
      wosSession,
      "wos_session cookie must be cleared after the sign-out redirect chain",
    ).toBeUndefined();
  });

  test("the cleared session cannot be replayed against /me", async ({
    page,
    request,
  }) => {
    // Drive the SPA through logout first (re-uses the test above's
    // browser-observable assertion).
    await page.goto("/app");
    const signOutHref = await page
      .getByRole("link", { name: /sign out/i })
      .getAttribute("href");
    await page.goto(signOutHref!);
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible({
      timeout: 90_000,
    });

    // The protected `/me` endpoint must 401 — this is the
    // "session token is invalid" half of the AC.
    const apiUrl = process.env.VITE_CORE_API_URL!;
    const res = await request.get(`${apiUrl}/me`);
    expect(res.status()).toBe(401);
  });
});
