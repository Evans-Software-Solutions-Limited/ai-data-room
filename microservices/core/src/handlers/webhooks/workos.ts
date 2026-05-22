// WorkOS webhook routing handler.
//
// Slice 1 / T-016. Single Lambda entry point at `POST /webhooks/workos`.
// Sits outside the Elysia stack (see `infra/api.ts`) so API Gateway
// passes the raw body bytes through unmodified — the HMAC signature
// verification breaks if anything pre-parses the JSON.
//
// Flow per request:
//   1. Verify the WorkOS signature against the raw body. Failure
//      modes (`missing_signature` / `invalid_signature` / `invalid_json`
//      / `missing_secret`) → 401.
//   2. Dedup: insert into `webhook_deliveries` with the WorkOS event
//      id as the PK. A redelivery hits ON CONFLICT DO NOTHING and
//      we return 200 with `{ replay: true }` without routing.
//   3. Route by `event.event` to one of the three application
//      functions we currently wire (see EVENT_HANDLERS below). Other
//      event types ack as `{ ignored: true }` — both events that
//      we genuinely don't react to (e.g. `session.created`) and
//      those we'd like to react to but don't yet have clean WorkOS-
//      side mappings for (`authentication.mfa_enrolled` —
//      `handleMfaEnrolled` and `handleRecoveryCodeUsed` exist as
//      application functions but the design.md event names don't
//      match the v8.13 SDK's event union; investigation deferred).
//   4. Application-handler exceptions → 500 so WorkOS retries; the
//      dedup row already exists, so a future retry within the WorkOS
//      window will hit the replay short-circuit. To re-execute after
//      a 500, the operator must delete the dedup row by hand.
//      Trade-off: choosing "store dedup before routing" gives us the
//      DoD's "exactly one audit row" guarantee at the cost of needing
//      manual recovery on hard failures. Acceptable for v0.1.
//
// Authorization: webhook authenticity is the signature check. There
// is no user-actor identity; the audit context records the WorkOS
// source IP and User-Agent header for forensics.
//
// Pure routing logic lives in `routeWorkOSWebhook` so unit tests can
// inject mocked deps; the production wrapper that wires `Resource.*`
// secrets + a Drizzle client lives in the sibling `workosLambda.ts`
// (excluded from the unit-coverage gate as pure wiring, mirroring
// `src/api.ts`).

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { serializeError } from "@ai-data-room/api-utils/logging";

import { logger } from "../../infrastructure/logging/logger";
import { emitCount } from "../../infrastructure/observability/metrics";
import { tracer } from "../../infrastructure/observability/tracer";
import type {
  AcceptInvitationInput,
  AcceptInvitationResult,
} from "../../application/invitations";
import type {
  HandlePasswordResetCompletedInput,
  HandlePasswordResetCompletedResult,
} from "../../application/password-reset";
import type {
  HandleUserDeletedInput,
  HandleUserDeletedResult,
} from "../../application/deletion";
import { type AuditContext } from "../../application/_audit-context";
import type { WebhookDeliveryRepo } from "../../infrastructure/db/webhookDeliveryRepo";
import { type VerifyWorkOSWebhookResult } from "../../infrastructure/workos/webhook";

// ---------------------------------------------------------------------------
// Routing logic — pure, deps-injected for testing
// ---------------------------------------------------------------------------

export interface WorkOSWebhookDeps {
  webhookSecret: string;
  webhookRepo: WebhookDeliveryRepo;
  /** Verify function injection lets tests bypass the real HMAC math
   * with a deterministic mock; production wires the real
   * `verifyWorkOSWebhook` import. */
  verify: (input: {
    rawBody: string;
    signatureHeader: string;
    secret: string;
  }) => Promise<VerifyWorkOSWebhookResult>;
  /**
   * Pre-bound application-handler invocations. Production binds each
   * to its `(input, deps) => result` shape with the relevant repos +
   * SDK clients; tests replace with `vi.fn()` mocks directly. Cleaner
   * than injecting application functions + a separate deps bag —
   * tests don't have to construct mock deps shapes that the routing
   * function never inspects anyway.
   */
  routes: {
    userDeleted: (
      input: HandleUserDeletedInput,
    ) => Promise<HandleUserDeletedResult>;
    passwordResetCompleted: (
      input: HandlePasswordResetCompletedInput,
    ) => Promise<HandlePasswordResetCompletedResult>;
    invitationAccepted: (
      input: AcceptInvitationInput,
    ) => Promise<AcceptInvitationResult>;
  };
}

export async function routeWorkOSWebhook(
  event: APIGatewayProxyEventV2,
  deps: WorkOSWebhookDeps,
): Promise<APIGatewayProxyStructuredResultV2> {
  const rawBody = event.body ?? "";
  // API Gateway HTTP API v2 normalizes all header names to lowercase
  // before invoking the Lambda — the lowercase lookup is the only
  // form we'll ever see in production.
  const signatureHeader = event.headers["workos-signature"] ?? "";

  emitCount("auth.webhook.workos.received");

  const verify = await deps.verify({
    rawBody,
    signatureHeader,
    secret: deps.webhookSecret,
  });
  if (!verify.ok) {
    if (
      verify.reason === "invalid_signature" ||
      verify.reason === "missing_signature"
    ) {
      // Either is a "we couldn't trust this caller" signal — alarmed
      // because both are exfil indicators (bad key OR a spoofed
      // request that didn't bother to sign). One metric covers both.
      emitCount("auth.webhook.workos.invalid_signature");
    }
    return jsonResponse(401, { ok: false, reason: verify.reason });
  }

  const wsEvent = verify.event;
  tracer.putAnnotation("eventType", wsEvent.event);

  // Dedup BEFORE routing. The application handlers themselves are
  // already idempotent for state, but they emit an `outcome:
  // "failure"` audit on redelivery which would violate the spec's
  // "exactly one audit row" guarantee.
  const dedup = await deps.webhookRepo.markDelivered(wsEvent.id, wsEvent.event);
  if (!dedup.firstDelivery) {
    return jsonResponse(200, {
      ok: true,
      replay: true,
      eventId: wsEvent.id,
      eventType: wsEvent.event,
    });
  }

  const audit: AuditContext = {
    sourceIp: event.requestContext?.http?.sourceIp ?? "unknown",
    userAgent: event.headers["user-agent"] ?? "WorkOS-Webhooks",
  };

  try {
    switch (wsEvent.event) {
      case "user.deleted": {
        const result = await deps.routes.userDeleted({
          workosUserId: wsEvent.data.id,
          audit,
        });
        return jsonResponse(200, {
          ok: true,
          eventType: wsEvent.event,
          eventId: wsEvent.id,
          scrubbed: result.user !== null,
        });
      }

      case "password_reset.succeeded": {
        const result = await deps.routes.passwordResetCompleted({
          workosUserId: wsEvent.data.userId,
          audit,
        });
        return jsonResponse(200, {
          ok: true,
          eventType: wsEvent.event,
          eventId: wsEvent.id,
          revokedSessions: result.revokedSessions,
        });
      }

      case "invitation.accepted": {
        // `acceptedUserId` is null until WorkOS has finished
        // wiring the accepting user — defensive skip rather than a
        // 5xx so the webhook isn't permanently retried.
        if (!wsEvent.data.acceptedUserId) {
          return jsonResponse(200, {
            ok: true,
            ignored: true,
            eventType: wsEvent.event,
            reason: "no_accepted_user_id",
          });
        }
        const result = await deps.routes.invitationAccepted({
          workosInvitationId: wsEvent.data.id,
          workosUserId: wsEvent.data.acceptedUserId,
          email: wsEvent.data.email,
          // `fullName` is set later via /me / profile editing
          // (slice 1 doesn't expose those endpoints).
          fullName: null,
          // FR9: clicking the invite link is implicit email
          // verification, so the accepted user's email is
          // verified by definition at the moment this fires.
          emailVerified: true,
          audit,
        });
        return jsonResponse(200, {
          ok: true,
          eventType: wsEvent.event,
          eventId: wsEvent.id,
          accepted: result.invitation?.state === "accepted",
        });
      }

      default:
        // Includes: user.created, user.updated, session.created,
        // session.revoked, authentication.* — events we don't
        // currently react to. Acked so WorkOS stops retrying; the
        // dedup row records the delivery for forensics.
        return jsonResponse(200, {
          ok: true,
          ignored: true,
          eventType: wsEvent.event,
          eventId: wsEvent.id,
        });
    }
  } catch (err) {
    // Application handler threw — surface a 500 so WorkOS retries.
    // The dedup row remains; manual operator recovery is via row
    // delete + re-trigger from the WorkOS dashboard. Log the full
    // error for forensics; expose only a generic reason in the
    // response body so we don't leak internal detail (DB hosts,
    // stack frame paths) to WorkOS's delivery log.
    logger.error("workos webhook handler_error", {
      eventType: wsEvent.event,
      eventId: wsEvent.id,
      error: serializeError(err),
    });
    return jsonResponse(500, {
      ok: false,
      reason: "handler_error",
      eventType: wsEvent.event,
      eventId: wsEvent.id,
    });
  }
}

function jsonResponse(
  statusCode: number,
  body: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
