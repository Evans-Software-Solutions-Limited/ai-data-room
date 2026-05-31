// Build an `AuditContext` from an Elysia handler's headers — the
// `sourceIp` + `userAgent` pair that every audit-emitting application
// function expects.
//
// Slice 1 / T-014b. The webhook Lambda (T-016) reads these from the
// raw `APIGatewayProxyEventV2`'s `requestContext.http.sourceIp` and
// `headers["user-agent"]`. Elysia hides the raw event behind its
// `request`/`headers` abstraction, so for protected handlers we lift
// the same shape from headers.
//
// **XFF parsing — rightmost is trusted, not leftmost.** API Gateway
// HTTP API v2 appends the real TCP source IP to whatever the client
// sent in `X-Forwarded-For` (it never replaces). The rightmost
// non-empty entry is therefore the gateway-attested client IP that
// can't be spoofed; the leftmost is client-controlled and would let a
// hostile client write any IP they like into the audit row's
// `source_ip`. Mirrors the rightmost-trusted logic in
// `middleware/rateLimit.ts#extractClientIp` — both call sites must
// agree on the trust boundary.
//
// Both fields have safe `"unknown"` fallbacks so audit emission never
// fails because the request didn't carry the headers — that would
// mask the real flow's outcome behind an audit-context error. Note
// the downstream caveat: `RecordAuditEventInputSchema`'s
// `sourceIp: z.string().ip()` will reject `"unknown"` and `safeAudit`
// will swallow the parse error → audit row silently dropped. That's
// a latent issue when XFF is genuinely missing (API Gateway always
// sets it in production, so the path is unreachable there), tracked
// separately from this PR.

import type { AuditContext } from "../../_audit-context";

export function buildAuditContext(
  headers: Record<string, string | undefined>,
): AuditContext {
  return {
    sourceIp: extractSourceIp(headers["x-forwarded-for"]),
    userAgent: headers["user-agent"] ?? "unknown",
  };
}

/**
 * Returns the rightmost non-empty entry of `x-forwarded-for` (the
 * IP API Gateway HTTP API v2 wrote — clients can't forge it because
 * the gateway appends, never replaces). Returns `"unknown"` if the
 * header is missing / empty / just commas.
 *
 * Exported so public handlers that need the same trust boundary
 * (e.g. `getSignOutHandler` per Lead S) don't re-derive the logic.
 * Mirror — and stay aligned with — `middleware/rateLimit.ts#extractClientIp`.
 */
export function extractSourceIp(xff: string | null | undefined): string {
  if (typeof xff !== "string" || xff.length === 0) {
    return "unknown";
  }
  const parts = xff.split(",");
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts[i]?.trim();
    if (candidate && candidate.length > 0) return candidate;
  }
  return "unknown";
}
