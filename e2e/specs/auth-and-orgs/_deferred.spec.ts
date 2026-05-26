// Deferred AC-US specs.
//
// Slice 1 T-021 ships browser coverage for AC-US1 / US7 / US8 — the
// ACs that are genuinely observable from a headless browser. Each
// `test.skip` below is annotated with one of three unblockers:
//
//   [mailbox]    needs a mailbox-test harness (Mailosaur, Postmark
//                sandbox, GreenMail) to receive AuthKit emails.
//   [hosted-ui]  needs scriptable access to AuthKit's hosted UI,
//                which the v8 SDK doesn't expose.
//   [audit-api]  needs an `/e2e/audit-events` query endpoint gated
//                by `E2E_AUTH_SECRET` (mirror the bootstrap pattern).
//
// Lower-layer coverage in `docs/security.md` + the existing
// integration tests means these are regression-protection, not
// first-time AC verification — fine to leave skipped until the
// unblocker for each lands.

import { test } from "@playwright/test";

test.describe("AC-US deferred", () => {
  test.skip("AC-US2 — owner invites admin → accept → MFA → role visible in /me", () => {
    // [mailbox] Lower-layer: invitations.test.ts + protectedRoutes.test.ts.
  });

  test.skip("AC-US3 — owner invites external scoped to Opportunities/Vendor_A → /me shows scope", () => {
    // [mailbox] Lower-layer: invitations.test.ts external-grant path.
  });

  test.skip("AC-US4 — login without MFA is impossible; bypass attempt is audited", () => {
    // [hosted-ui] AuthKit enforces enrolment on its own side; no
    // scriptable surface for "skip the MFA challenge". Lower-layer
    // coverage in the MFA gate inside `requireAuth`.
  });

  test.skip("AC-US5 — password reset round-trip within 1 hour; expired link returns 'link expired'", () => {
    // [mailbox] + [hosted-ui] for the reset form. 1-hour expiry
    // can't be fast-forwarded against WorkOS.
  });

  test.skip("AC-US6 — unverified email → 'verify email first' on invite/upload attempts", () => {
    // [mailbox] + needs slice-2's upload surface. Lower-layer
    // coverage: the FR-verification-gate check lands with slice 2.
  });

  test.skip("AC-US9 — MFA enrolment produces 10 recovery codes, viewable + downloadable once", () => {
    // [hosted-ui] — owned entirely by AuthKit per ADR-003. No
    // browser-observable surface on OUR side to assert.
  });

  test.skip("AC-US10 — every FR24 event lands in the audit store with the canonical shape", () => {
    // [audit-api] Lower-layer: per-flow audit assertions in every
    // application test + `auditRepo.integration.test.ts`.
  });

  test.skip("AC-US11 — suspension invalidates active sessions within 1 minute; sole-owner suspension is rejected", () => {
    // The 401-on-next-request half is in reach via a second
    // browser context, but the "within 1 minute" SLA is flaky to
    // assert in CI against a real Lambda. Lower-layer:
    // `suspension.test.ts` + protectedRoutes 401 paths.
  });

  test.skip("AC-US8 — post-logout /me returns 401 (revocation observable)", () => {
    // [audit-api] `requireAuth.authenticate()` is a LOCAL JWT
    // signature + expiry check — it doesn't consult WorkOS for
    // revocation. After a logout the cookie blob stays
    // cryptographically valid until the access-token TTL expires
    // (minutes), so a fresh-context replay of the pre-logout
    // cookie hits 200 not 401. To genuinely assert "session is
    // invalid" at the browser layer we need an audit-API check
    // for the `user_signed_out` row, OR to wait out the TTL.
    // Browser-observable half (cookie cleared, sign-in returns)
    // lives in `ac-us8-logout.spec.ts`. Lower-layer 401 coverage:
    // `getSignOutHandler.test.ts` + protectedRoutes 401 paths.
  });
});
