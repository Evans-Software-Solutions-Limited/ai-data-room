// AC-US1 (happy-path slice) — once authenticated, the SPA lands the
// user on a "you're logged in" state at `/app`.
//
// The full AC-US1 ("new user completes signup, receives verification
// email, clicks the link, returns authenticated, enrols MFA, lands
// on a 'you're logged in' state") can't be driven end-to-end from
// Playwright without scraping AuthKit's hosted UI and a live
// mailbox. The bootstrap endpoint lets us land at the equivalent
// "already authenticated" point and verify the SPA picks up the
// session.
//
// `AppWorkspace.tsx` has two render branches depending on `/me`'s
// `orgId`: a provisioned-user `<dl>` of the payload, or an
// unprovisioned "Welcome to AI Data Room" placeholder (the
// lazy-mirror creates the user but org provisioning lands in
// slice 9). The spec asserts only on what's invariant across both
// — the authenticated navbar is present and the sign-out anchor
// is absolute. The dl-content branch gets covered by the slice-9
// onboarding flow's e2e suite when it ships.

import { expect, test } from "@playwright/test";

test.describe("AC-US1 — authenticated user lands on /app", () => {
  test("the SPA shows the authenticated navbar with an absolute sign-out anchor", async ({
    page,
  }) => {
    await page.goto("/app");

    // `useGetCurrentUser` may briefly show the layout's Loader on
    // first paint while TanStack Query resolves the cached cookie
    // session. Wait for it to clear before asserting.
    await expect(page.getByRole("status", { name: /loading/i })).toBeHidden({
      timeout: 15_000,
    });

    // The authed navbar renders an absolute sign-out anchor. If the
    // cookie didn't land cleanly the SPA would redirect to "/"
    // instead — asserting sign-out's presence + absolute href is
    // the cheap proof that we're really authenticated AND that
    // VITE_CORE_API_URL was baked into the build.
    const signOut = page.getByRole("link", { name: /sign out/i });
    await expect(signOut).toBeVisible();
    const signOutHref = await signOut.getAttribute("href");
    expect(
      signOutHref,
      "sign-out href must be absolute — check VITE_CORE_API_URL is baked into the build",
    ).toMatch(/^https?:\/\//);
  });
});
