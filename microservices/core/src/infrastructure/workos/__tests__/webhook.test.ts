// Webhook signature-verification tests.
//
// "Tests required: ... real signature verification against a
// known-good fixture." per T-006 DoD. We do that by minting the
// signature with the WorkOS SDK's own `computeSignature` helper —
// same code path WorkOS uses on the wire — and feeding the result
// into our wrapper. This catches drift in either direction: if the
// SDK rotates its scheme or our wrapper accidentally pre-parses,
// these tests fail.

import { describe, expect, it } from "vitest";
import { WorkOS } from "@workos-inc/node";

import { verifyWorkOSWebhook } from "../webhook";

const SECRET = "whsec_test_known_good";

interface FixturePayload extends Record<string, unknown> {
  id: string;
  event: string;
  data: Record<string, unknown>;
  createdAt: string;
}

const FIXTURE_PAYLOAD: FixturePayload = {
  id: "event_test_123",
  event: "user.created",
  data: {
    object: "user",
    id: "user_test_abc",
    email: "alice@example.com",
  },
  createdAt: "2026-04-28T10:00:00Z",
};

/**
 * Mint a valid `(rawBody, signatureHeader)` pair using the SDK's
 * `computeSignature`. Hides a few quirks from the test bodies:
 *   - Timestamp goes into both the HMAC input AND the header — the
 *     two MUST match.
 *   - The header format is `t=<timestamp>, v1=<sig>`.
 *   - rawBody is `JSON.stringify(payload)` — `constructEvent` parses
 *     it back, so the canonical string must round-trip exactly.
 */
async function mintSignedDelivery(
  payload: Record<string, unknown>,
  options: { secret?: string; timestampMs?: number } = {},
): Promise<{ rawBody: string; signatureHeader: string }> {
  const { secret = SECRET, timestampMs = Date.now() } = options;
  // PKCE-mode constructor — `clientId`-only is accepted; we never
  // call any API method on the resulting instance, only the
  // signature helper.
  const sdk = new WorkOS({ clientId: "webhook-test" });
  const signature = await sdk.webhooks.computeSignature(
    timestampMs,
    payload,
    secret,
  );
  return {
    rawBody: JSON.stringify(payload),
    signatureHeader: `t=${timestampMs}, v1=${signature}`,
  };
}

describe("verifyWorkOSWebhook", () => {
  describe("happy path (real signature, real verification)", () => {
    it("accepts a freshly-signed delivery and returns the parsed event", async () => {
      const { rawBody, signatureHeader } =
        await mintSignedDelivery(FIXTURE_PAYLOAD);

      const result = await verifyWorkOSWebhook({
        rawBody,
        signatureHeader,
        secret: SECRET,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.event.id).toBe("event_test_123");
        expect(result.event.event).toBe("user.created");
      }
    });
  });

  describe("rejection paths", () => {
    it("rejects a tampered body — same signature header, mutated payload", async () => {
      const { signatureHeader } = await mintSignedDelivery(FIXTURE_PAYLOAD);
      const tamperedBody = JSON.stringify({
        ...FIXTURE_PAYLOAD,
        data: { ...FIXTURE_PAYLOAD.data, id: "user_attacker" },
      });

      const result = await verifyWorkOSWebhook({
        rawBody: tamperedBody,
        signatureHeader,
        secret: SECRET,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_signature");
    });

    it("rejects a tampered signature — same body, mutated header v1", async () => {
      const { rawBody, signatureHeader } =
        await mintSignedDelivery(FIXTURE_PAYLOAD);
      // Flip the last hex character of the signature so we still pass
      // structural parsing inside the SDK but fail HMAC comparison.
      const flipped = signatureHeader.replace(
        /(v1=[0-9a-f]+)([0-9a-f])$/,
        (_, prefix: string, last: string) =>
          `${prefix}${last === "f" ? "0" : "f"}`,
      );

      const result = await verifyWorkOSWebhook({
        rawBody,
        signatureHeader: flipped,
        secret: SECRET,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_signature");
    });

    it("rejects a delivery signed with the wrong secret", async () => {
      const { rawBody, signatureHeader } = await mintSignedDelivery(
        FIXTURE_PAYLOAD,
        { secret: "whsec_attacker" },
      );

      const result = await verifyWorkOSWebhook({
        rawBody,
        signatureHeader,
        secret: SECRET,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_signature");
    });

    it("rejects a stale delivery when tolerance is set to 0", async () => {
      const tenMinutesAgoMs = Date.now() - 10 * 60 * 1000;
      const { rawBody, signatureHeader } = await mintSignedDelivery(
        FIXTURE_PAYLOAD,
        { timestampMs: tenMinutesAgoMs },
      );

      const result = await verifyWorkOSWebhook({
        rawBody,
        signatureHeader,
        secret: SECRET,
        tolerance: 0,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_signature");
    });
  });

  describe("structural failures (don't reach the SDK)", () => {
    it("returns missing_signature when the header is empty", async () => {
      const result = await verifyWorkOSWebhook({
        rawBody: JSON.stringify(FIXTURE_PAYLOAD),
        signatureHeader: "",
        secret: SECRET,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("missing_signature");
    });

    it("returns missing_secret when the secret is empty", async () => {
      const { rawBody, signatureHeader } =
        await mintSignedDelivery(FIXTURE_PAYLOAD);
      const result = await verifyWorkOSWebhook({
        rawBody,
        signatureHeader,
        secret: "",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("missing_secret");
    });

    it("returns invalid_json with the parser error when the body is malformed", async () => {
      const { signatureHeader } = await mintSignedDelivery(FIXTURE_PAYLOAD);
      const result = await verifyWorkOSWebhook({
        rawBody: "{ this is not json",
        signatureHeader,
        secret: SECRET,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid_json");
        expect(result.error).toMatch(/JSON/i);
      }
    });
  });
});
