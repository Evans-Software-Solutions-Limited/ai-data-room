// WorkOS webhook signature verification helper.
//
// Slice 1 / T-006. The webhook handler proper lands in T-016 — this
// module only owns the verify-and-parse step so T-016's handler can
// stay shaped as "read raw body, call this, route by event type".
//
// Why a separate module from `client.ts`: webhook verification has a
// different identity (the *webhook secret*, not the *API key*), runs
// on a different Lambda (raw-body Lambda for HMAC), and has a much
// narrower public surface. Splitting them keeps each file
// independently mockable.
//
// The actual HMAC scheme lives inside `@workos-inc/node`'s
// `Webhooks.constructEvent`. We delegate so that any future scheme
// rotation by WorkOS (e.g. v2 of the signature header) doesn't need
// a re-implementation here. The wrapper only adds:
//   - Required-field validation up front (so the failure mode is
//     "401 with reason" rather than "500 from a TypeError").
//   - A tagged-union return shape (`{ ok: true, event } | { ok: false, reason }`)
//     so callers can branch without try/catch noise.

import { WorkOS } from "@workos-inc/node";
import type { Event as WorkOSEvent } from "@workos-inc/node";

export type { WorkOSEvent };

// `new WorkOS({ clientId })` is the SDK's PKCE-mode constructor —
// it's the only way to get a `WorkOS` instance without an API key.
// Webhook signature verification is HMAC-only and never touches the
// API client, but the SDK requires us to pick one of {apiKey,
// clientId}. The clientId we pass is never sent over the wire.
const WEBHOOK_VERIFY_SDK_CLIENT_ID = "webhook-verify";

/**
 * Inputs for the verifier. `rawBody` must be the exact bytes that
 * arrived on the wire — pre-parse JSON.parse mutation will break the
 * HMAC. API Gateway HTTP API delivers `event.body` as a string; we
 * parse it inside the verifier so callers can't accidentally feed in
 * an already-parsed object.
 *
 * `tolerance` is the +/- seconds the signature timestamp is allowed
 * to drift from now. WorkOS SDK default is 5 minutes; we keep the
 * default but expose the knob for tests that want to assert the
 * staleness branch without sleeping.
 */
export interface VerifyWorkOSWebhookOptions {
  rawBody: string;
  signatureHeader: string;
  secret: string;
  tolerance?: number;
}

export type VerifyWorkOSWebhookFailureReason =
  | "missing_signature"
  | "missing_secret"
  | "invalid_json"
  | "invalid_signature";

export type VerifyWorkOSWebhookResult =
  | { ok: true; event: WorkOSEvent }
  | { ok: false; reason: VerifyWorkOSWebhookFailureReason; error?: string };

/**
 * Verify a WorkOS webhook delivery and return its parsed event.
 *
 * Returns a tagged union so handlers can pattern-match the failure
 * cases without try/catch — they all map to a 401 in T-016, but
 * splitting the reasons keeps the access-log entries useful.
 *
 * The "missing signature" / "missing secret" branches don't call into
 * the SDK at all — those failures are operational (caller bug or
 * mis-deployed secret), not signature failures. Keeping them
 * pre-SDK avoids a confusing "Invalid signature" message on what's
 * actually an upstream wiring issue.
 */
export async function verifyWorkOSWebhook(
  options: VerifyWorkOSWebhookOptions,
): Promise<VerifyWorkOSWebhookResult> {
  const { rawBody, signatureHeader, secret, tolerance } = options;

  if (!signatureHeader) {
    return { ok: false, reason: "missing_signature" };
  }
  if (!secret) {
    return { ok: false, reason: "missing_secret" };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_json",
      error: err instanceof Error ? err.message : "unknown",
    };
  }

  const sdk = new WorkOS({ clientId: WEBHOOK_VERIFY_SDK_CLIENT_ID });
  try {
    const event = await sdk.webhooks.constructEvent({
      payload,
      sigHeader: signatureHeader,
      secret,
      tolerance,
    });
    return { ok: true, event };
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_signature",
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}
