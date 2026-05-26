// AC-US8 — after logout, the prior session token is invalid; using
// it returns 401; an audit event records the logout.
//
// What this spec asserts (the browser-observable half):
//   - the sign-out redirect chain clears the `wos_session` cookie
//   - the anonymous nav variant renders again on the next page load
//
// What this spec deliberately doesn't assert (deferred to
// `_deferred.spec.ts` under [audit-api]):
//   - `/me` returns 401 immediately after sign-out. `requireAuth`
//     runs `session.authenticate()` first, which is a LOCAL JWT
//     signature + expiry check — it doesn't consult WorkOS for
//     revocation. The cookie's sealed access-token JWT stays
//     cryptographically valid for the access-token TTL (minutes)
//     even after WorkOS marks the session revoked. `refresh()`
//     would notice the revocation but only fires when
//     `authenticate()` fails. To genuinely assert "session is
//     invalid" at the browser layer we'd need an audit-API query
//     or to wait out the TTL — both belong in the deferred suite.
//
// Lower-layer coverage for the "/me 401" half is in
// `getSignOutHandler.test.ts` + the protected-routes test 401
// paths; the "audit event recorded" half is in
// `audit.integration.test.ts`.

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
});
