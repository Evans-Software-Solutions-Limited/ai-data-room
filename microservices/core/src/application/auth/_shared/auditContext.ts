// Build an `AuditContext` from an Elysia handler's headers — the
// `sourceIp` + `userAgent` pair that every audit-emitting application
// function expects.
//
// Slice 1 / T-014b. The webhook Lambda (T-016) reads these from the
// raw `APIGatewayProxyEventV2`'s `requestContext.http.sourceIp` and
// `headers["user-agent"]`. Elysia hides the raw event behind its
// `request`/`headers` abstraction, so for protected handlers we lift
// the same shape from headers:
//
//   - `x-forwarded-for` is set by API Gateway; the leftmost IP is
//     the originating client.
//   - `user-agent` falls through unchanged.
//
// Both have safe `"unknown"` fallbacks so audit emission never fails
// because the request didn't carry the headers — that would mask the
// real flow's outcome behind an audit-context error.

import type { AuditContext } from "../../_audit-context";

export function buildAuditContext(
  headers: Record<string, string | undefined>,
): AuditContext {
  return {
    sourceIp: extractSourceIp(headers),
    userAgent: headers["user-agent"] ?? "unknown",
  };
}

function extractSourceIp(headers: Record<string, string | undefined>): string {
  const xff = headers["x-forwarded-for"];
  if (typeof xff !== "string" || xff.length === 0) {
    return "unknown";
  }
  // X-Forwarded-For can be a comma-separated chain of proxies; the
  // leftmost entry is the originating client. Trim to handle the
  // common `"a, b"` format with a space after the comma.
  const first = xff.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}
