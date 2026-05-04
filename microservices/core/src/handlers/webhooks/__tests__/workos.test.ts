// Unit tests for the WorkOS webhook routing handler.
//
// Targets `routeWorkOSWebhook` (the deps-injected pure function),
// not `handler` (the Lambda entrypoint that wires `Resource.*`).
// Production wiring lives in `infra/api.ts`; the dedup contract is
// proven against real Postgres in
// `webhookDeliveryRepo.integration.test.ts`.

import { describe, expect, it, vi } from "vitest";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { routeWorkOSWebhook } from "../workos";

const WEBHOOK_SECRET = "whsec_test_secret";

// ─── Fixture helpers ──────────────────────────────────────────────────

function makeRequest(
  body: Record<string, unknown>,
  signatureHeader = "t=1,v1=signed",
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /webhooks/workos",
    rawPath: "/webhooks/workos",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "user-agent": "WorkOS-Webhooks/1.0",
      "workos-signature": signatureHeader,
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/webhooks/workos",
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.5",
        userAgent: "WorkOS-Webhooks/1.0",
      },
      requestId: "req_test",
      routeKey: "POST /webhooks/workos",
      stage: "$default",
      time: "2026-05-04T10:00:00Z",
      timeEpoch: 1746353000,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function makeDeps(
  overrides: {
    verifyResult?: ReturnType<typeof vi.fn>;
    markDelivered?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const verify =
    overrides.verifyResult ??
    vi.fn().mockResolvedValue({
      ok: true,
      event: {
        id: "event_01HAPPY",
        event: "user.deleted",
        data: { id: "user_workos_target" },
      },
    });
  const markDelivered =
    overrides.markDelivered ??
    vi.fn().mockResolvedValue({
      firstDelivery: true,
      delivery: {
        eventId: "event_01HAPPY",
        eventType: "user.deleted",
        receivedAt: new Date(),
      },
    });
  // Routes are pre-bound `(input) => result` — production binds
  // them with the right repo / SDK deps; tests override per case.
  const userDeleted = vi.fn().mockResolvedValue({ user: null });
  const passwordResetCompleted = vi
    .fn()
    .mockResolvedValue({ revokedSessions: 0, user: null });
  const invitationAccepted = vi.fn().mockResolvedValue({
    invitation: null,
    user: null,
    membership: null,
    grant: null,
  });
  return {
    webhookSecret: WEBHOOK_SECRET,
    webhookRepo: { markDelivered } as never,
    verify,
    routes: {
      userDeleted,
      passwordResetCompleted,
      invitationAccepted,
    },
    markDelivered,
    userDeleted,
    passwordResetCompleted,
    invitationAccepted,
  };
}

function parseBody(result: APIGatewayProxyStructuredResultV2) {
  return JSON.parse(result.body ?? "{}");
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("routeWorkOSWebhook", () => {
  describe("signature verification", () => {
    it("returns 401 when the signature header is missing", async () => {
      const deps = makeDeps({
        verifyResult: vi
          .fn()
          .mockResolvedValue({ ok: false, reason: "missing_signature" }),
      });

      const result = await routeWorkOSWebhook(makeRequest({}, ""), deps);

      expect(result.statusCode).toBe(401);
      expect(parseBody(result)).toEqual({
        ok: false,
        reason: "missing_signature",
      });
      expect(deps.markDelivered).not.toHaveBeenCalled();
    });

    it("returns 401 on invalid signature without touching the dedup ledger", async () => {
      const deps = makeDeps({
        verifyResult: vi
          .fn()
          .mockResolvedValue({ ok: false, reason: "invalid_signature" }),
      });

      const result = await routeWorkOSWebhook(makeRequest({}), deps);

      expect(result.statusCode).toBe(401);
      expect(parseBody(result).reason).toBe("invalid_signature");
      // A tampered payload must NOT consume an event id in the
      // ledger — otherwise an attacker could pre-populate the
      // ledger with future event ids and prevent legitimate
      // events from being processed.
      expect(deps.markDelivered).not.toHaveBeenCalled();
      expect(deps.userDeleted).not.toHaveBeenCalled();
    });

    it("treats a truly absent (undefined) signature header the same as an empty one", async () => {
      // Defends the `event.headers["workos-signature"] ?? ""`
      // nullish-coalesce: passing "" doesn't trigger the
      // fallback (empty string is truthy in `??`); only an
      // undefined header does. The verifier sees "" either way
      // and returns missing_signature.
      const req = makeRequest({});
      delete (req.headers as Record<string, string>)["workos-signature"];
      const deps = makeDeps({
        verifyResult: vi
          .fn()
          .mockResolvedValue({ ok: false, reason: "missing_signature" }),
      });

      const result = await routeWorkOSWebhook(req, deps);

      expect(result.statusCode).toBe(401);
      expect(deps.verify).toHaveBeenCalledWith(
        expect.objectContaining({ signatureHeader: "" }),
      );
    });

    it("returns 401 on invalid_json", async () => {
      const deps = makeDeps({
        verifyResult: vi
          .fn()
          .mockResolvedValue({ ok: false, reason: "invalid_json" }),
      });
      const result = await routeWorkOSWebhook(makeRequest({}), deps);
      expect(result.statusCode).toBe(401);
    });
  });

  describe("dedup short-circuit (DoD: replay 3× → exactly one state change)", () => {
    it("returns 200 with replay=true when markDelivered reports firstDelivery=false", async () => {
      const deps = makeDeps({
        markDelivered: vi.fn().mockResolvedValue({
          firstDelivery: false,
          delivery: {
            eventId: "event_01REPLAY",
            eventType: "user.deleted",
            receivedAt: new Date("2026-05-04T09:00:00Z"),
          },
        }),
      });

      const result = await routeWorkOSWebhook(makeRequest({}), deps);

      expect(result.statusCode).toBe(200);
      expect(parseBody(result)).toMatchObject({
        ok: true,
        replay: true,
      });
      expect(deps.userDeleted).not.toHaveBeenCalled();
    });

    it("calls markDelivered with the event id and event type from the verified payload", async () => {
      const deps = makeDeps({
        verifyResult: vi.fn().mockResolvedValue({
          ok: true,
          event: {
            id: "event_01ROUTE",
            event: "user.deleted",
            data: { id: "user_workos_target" },
          },
        }),
      });

      await routeWorkOSWebhook(makeRequest({}), deps);

      expect(deps.markDelivered).toHaveBeenCalledWith(
        "event_01ROUTE",
        "user.deleted",
      );
    });
  });

  describe("event routing", () => {
    it("user.deleted → handleUserDeleted with the workos user id + audit context", async () => {
      const deps = makeDeps({
        verifyResult: vi.fn().mockResolvedValue({
          ok: true,
          event: {
            id: "event_01DEL",
            event: "user.deleted",
            data: { id: "user_workos_target" },
          },
        }),
      });
      deps.userDeleted.mockResolvedValue({
        user: { id: "11111111-1111-4111-8111-111111111111" } as never,
      });

      const result = await routeWorkOSWebhook(makeRequest({}), deps);

      expect(deps.userDeleted).toHaveBeenCalledWith(
        expect.objectContaining({
          workosUserId: "user_workos_target",
          audit: {
            sourceIp: "203.0.113.5",
            userAgent: "WorkOS-Webhooks/1.0",
          },
        }),
      );
      expect(result.statusCode).toBe(200);
      expect(parseBody(result)).toMatchObject({
        ok: true,
        eventType: "user.deleted",
        scrubbed: true,
      });
    });

    it("password_reset.succeeded → handlePasswordResetCompleted with the data.userId", async () => {
      const deps = makeDeps({
        verifyResult: vi.fn().mockResolvedValue({
          ok: true,
          event: {
            id: "event_01PWR",
            event: "password_reset.succeeded",
            data: { userId: "user_workos_resetter" },
          },
        }),
      });
      deps.passwordResetCompleted.mockResolvedValue({
        revokedSessions: 2,
        user: { id: "u" } as never,
      });

      const result = await routeWorkOSWebhook(makeRequest({}), deps);

      expect(deps.passwordResetCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ workosUserId: "user_workos_resetter" }),
      );
      expect(parseBody(result).revokedSessions).toBe(2);
    });

    it("invitation.accepted → acceptInvitation with FR9 implicit verification (emailVerified=true, fullName=null)", async () => {
      const deps = makeDeps({
        verifyResult: vi.fn().mockResolvedValue({
          ok: true,
          event: {
            id: "event_01INV",
            event: "invitation.accepted",
            data: {
              id: "invitation_workos_target",
              email: "invitee@example.com",
              acceptedUserId: "user_workos_invitee",
            },
          },
        }),
      });
      deps.invitationAccepted.mockResolvedValue({
        invitation: { state: "accepted" } as never,
        user: { id: "u" } as never,
        membership: null,
        grant: null,
      });

      const result = await routeWorkOSWebhook(makeRequest({}), deps);

      expect(deps.invitationAccepted).toHaveBeenCalledWith(
        expect.objectContaining({
          workosInvitationId: "invitation_workos_target",
          workosUserId: "user_workos_invitee",
          email: "invitee@example.com",
          fullName: null,
          // FR9: clicking the invite link is implicit verification.
          emailVerified: true,
        }),
      );
      expect(parseBody(result).accepted).toBe(true);
    });

    it("invitation.accepted with null acceptedUserId is acked as ignored (no_accepted_user_id)", async () => {
      // WorkOS can fire invitation.accepted before the user record
      // is fully wired; defensive skip rather than 5xx so we don't
      // get stuck in a permanent retry loop.
      const deps = makeDeps({
        verifyResult: vi.fn().mockResolvedValue({
          ok: true,
          event: {
            id: "event_01INV_NULL",
            event: "invitation.accepted",
            data: {
              id: "invitation_workos_target",
              email: "invitee@example.com",
              acceptedUserId: null,
            },
          },
        }),
      });

      const result = await routeWorkOSWebhook(makeRequest({}), deps);

      expect(deps.invitationAccepted).not.toHaveBeenCalled();
      expect(result.statusCode).toBe(200);
      expect(parseBody(result)).toMatchObject({
        ok: true,
        ignored: true,
        reason: "no_accepted_user_id",
      });
    });

    it("unknown event types ack as ignored without invoking any handler", async () => {
      const deps = makeDeps({
        verifyResult: vi.fn().mockResolvedValue({
          ok: true,
          event: {
            id: "event_01UNKNOWN",
            event: "session.revoked",
            data: {},
          },
        }),
      });

      const result = await routeWorkOSWebhook(makeRequest({}), deps);

      expect(result.statusCode).toBe(200);
      expect(parseBody(result)).toMatchObject({
        ok: true,
        ignored: true,
        eventType: "session.revoked",
      });
      expect(deps.userDeleted).not.toHaveBeenCalled();
      expect(deps.passwordResetCompleted).not.toHaveBeenCalled();
      expect(deps.invitationAccepted).not.toHaveBeenCalled();
    });
  });

  describe("application handler exceptions", () => {
    it("returns 500 with handler_error when a downstream throws — WorkOS will retry", async () => {
      const deps = makeDeps({
        verifyResult: vi.fn().mockResolvedValue({
          ok: true,
          event: {
            id: "event_01ERR",
            event: "user.deleted",
            data: { id: "user_workos_target" },
          },
        }),
      });
      deps.userDeleted.mockRejectedValue(new Error("DB down"));

      const result = await routeWorkOSWebhook(makeRequest({}), deps);

      expect(result.statusCode).toBe(500);
      // The response body deliberately omits the underlying error
      // message — WorkOS surfaces response bodies in its delivery
      // log, and a Drizzle / pg-driver error like "Cannot connect
      // to host db.foo.psdb.cloud:5432" would leak internal detail.
      // The full error is `console.error`'d for forensics instead.
      const body = parseBody(result);
      expect(body).toEqual({
        ok: false,
        reason: "handler_error",
        eventType: "user.deleted",
        eventId: "event_01ERR",
      });
      expect(body.error).toBeUndefined();
    });

    it("a handler exception leaves the dedup row in place — replay short-circuits the next attempt", async () => {
      // This is the load-bearing trade-off of "store dedup before
      // routing": if the application handler throws, the row was
      // already inserted, so the next WorkOS retry will see
      // firstDelivery=false and skip routing. Operator recovery
      // requires deleting the dedup row by hand. The first call
      // proves we DID call markDelivered before the throw fired.
      const deps = makeDeps({
        verifyResult: vi.fn().mockResolvedValue({
          ok: true,
          event: {
            id: "event_01ERR",
            event: "user.deleted",
            data: { id: "user_workos_target" },
          },
        }),
      });
      deps.userDeleted.mockRejectedValue(new Error("DB down"));

      await routeWorkOSWebhook(makeRequest({}), deps);

      expect(deps.markDelivered).toHaveBeenCalledTimes(1);
      expect(deps.markDelivered).toHaveBeenCalledWith(
        "event_01ERR",
        "user.deleted",
      );
    });

    it("logs a generic 'unknown' instead of message when a non-Error value is thrown", async () => {
      // Defends the `err instanceof Error` branch in the catch
      // block. TS code rarely throws non-Error values, but a
      // downstream `throw "some string"` shouldn't crash the
      // handler trying to read .message on a string.
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const deps = makeDeps({
        verifyResult: vi.fn().mockResolvedValue({
          ok: true,
          event: {
            id: "event_01NONERR",
            event: "user.deleted",
            data: { id: "user_workos_target" },
          },
        }),
      });
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      deps.userDeleted.mockImplementation(() => {
        throw "string thrown directly";
      });

      const result = await routeWorkOSWebhook(makeRequest({}), deps);

      expect(result.statusCode).toBe(500);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "workos webhook handler_error",
        expect.objectContaining({ error: "unknown" }),
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe("audit-context fallbacks", () => {
    it("falls back to 'unknown' source IP and 'WorkOS-Webhooks' user-agent when headers / requestContext are absent", async () => {
      // Defends the `?? "unknown"` and `?? "WorkOS-Webhooks"`
      // branches. API Gateway HTTP API v2 always provides both in
      // production, but the fallbacks keep the audit row valid if
      // an internal replay or test ever invokes the route without
      // them.
      const req = makeRequest({});
      // Strip both — simulates a malformed direct invocation.
      delete (req.headers as Record<string, string>)["user-agent"];
      // requestContext.http.sourceIp is required by the type, so
      // we cast through unknown to drop it.
      (
        req.requestContext as unknown as {
          http: Record<string, unknown>;
        }
      ).http = {};

      const deps = makeDeps();
      await routeWorkOSWebhook(req, deps);

      expect(deps.userDeleted).toHaveBeenCalledWith(
        expect.objectContaining({
          audit: { sourceIp: "unknown", userAgent: "WorkOS-Webhooks" },
        }),
      );
    });
  });
});
