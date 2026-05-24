// AC-US1 (happy-path slice) — once authenticated, the `/app` route
// shows the `/me` payload and renders the workspace shell.
//
// The full AC-US1 ("new user completes signup, receives verification
// email, clicks the link, returns authenticated, enrols MFA, lands
// on a 'you're logged in' state") is impossible to drive end-to-end
// from Playwright without scraping AuthKit's hosted UI and a live
// mailbox. The bootstrap endpoint lets us land at the equivalent
// "already authenticated" point and verify the rest of the flow
// (workspace render, `/me` payload visible, sign-out anchor wired).

import { expect, test } from "@playwright/test";

test.describe("AC-US1 — authenticated user lands on /app", () => {
  test("renders the workspace shell with the /me payload", async ({ page }) => {
    await page.goto("/app");

    // `useGetCurrentUser` may briefly show the layout's Loader on
    // first paint while TanStack Query resolves the cached cookie
    // session. Wait for it to clear before asserting the payload.
    await expect(page.getByRole("status", { name: /loading/i })).toBeHidden({
      timeout: 15_000,
    });

    // The authed navbar renders an absolute sign-out anchor. If the
    // wos_session cookie didn't land cleanly the SPA would have
    // redirected to "/" instead — asserting the sign-out href is
    // the cheap proof that we're really authenticated.
    const signOut = page.getByRole("link", { name: /sign out/i });
    await expect(signOut).toBeVisible();
    const signOutHref = await signOut.getAttribute("href");
    expect(
      signOutHref,
      "sign-out href must be absolute — check VITE_CORE_API_URL is baked into the build",
    ).toMatch(/^https?:\/\//);

    // AppWorkspace.tsx renders the user's email + role into a <dl>.
    // The actual values come from the seeded WorkOS test user; we
    // assert structural presence rather than exact values to keep
    // the spec resilient to seed-data changes.
    await expect(page.getByText(/^Email$/)).toBeVisible();
    await expect(page.getByText(/^User ID$/)).toBeVisible();
  });
});
