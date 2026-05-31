// Unit tests for `buildAuditContext` — extracts `sourceIp` +
// `userAgent` from request headers in the shape every audit-emitting
// application function expects.
//
// XFF parsing semantics: API Gateway HTTP API v2 appends the real
// TCP source IP to whatever the client sent, so the **rightmost**
// non-empty entry is the gateway-attested IP and the trusted one.
// Reading the leftmost would let a client spoof source_ip on the
// audit row — see the header comment in `../auditContext.ts` for the
// full rationale.

import { describe, expect, it } from "vitest";

import { buildAuditContext, extractSourceIp } from "../auditContext";

describe("buildAuditContext", () => {
  it("returns the rightmost IP from x-forwarded-for (API Gateway v2's appended client IP)", () => {
    expect(
      buildAuditContext({
        "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178",
        "user-agent": "Mozilla/5.0 ...",
      }),
    ).toEqual({
      sourceIp: "150.172.238.178",
      userAgent: "Mozilla/5.0 ...",
    });
  });

  it("trims whitespace around the rightmost x-forwarded-for entry", () => {
    expect(
      buildAuditContext({
        "x-forwarded-for": " 203.0.113.5 , 70.41.3.18 ",
        "user-agent": "ua",
      }),
    ).toMatchObject({ sourceIp: "70.41.3.18" });
  });

  it("ignores client-controlled leftmost entries (spoofing resistance)", () => {
    // Threat model: a hostile client puts a fake IP in their own
    // X-Forwarded-For; API Gateway v2 appends the real source. The
    // leftmost is the spoof; the rightmost is the trusted append.
    // We must read the rightmost or the audit row's `source_ip` is
    // attacker-controlled.
    expect(
      buildAuditContext({
        "x-forwarded-for": "1.2.3.4, 203.0.113.5",
        "user-agent": "ua",
      }),
    ).toMatchObject({ sourceIp: "203.0.113.5" });
  });

  it("returns sourceIp='unknown' when x-forwarded-for is missing", () => {
    expect(
      buildAuditContext({
        "user-agent": "ua",
      }),
    ).toEqual({
      sourceIp: "unknown",
      userAgent: "ua",
    });
  });

  it("returns sourceIp='unknown' when x-forwarded-for is the empty string", () => {
    expect(
      buildAuditContext({
        "x-forwarded-for": "",
        "user-agent": "ua",
      }),
    ).toMatchObject({ sourceIp: "unknown" });
  });

  it("returns sourceIp='unknown' when x-forwarded-for is just commas / whitespace", () => {
    // Defensive — a malformed XFF header shouldn't be treated as a
    // valid IP. The downstream audit metadata expects a usable
    // string, not an empty one that breaks log-aggregation queries.
    expect(
      buildAuditContext({
        "x-forwarded-for": " , ",
        "user-agent": "ua",
      }),
    ).toMatchObject({ sourceIp: "unknown" });
  });

  it("returns userAgent='unknown' when the header is missing", () => {
    expect(
      buildAuditContext({
        "x-forwarded-for": "203.0.113.5",
      }),
    ).toEqual({
      sourceIp: "203.0.113.5",
      userAgent: "unknown",
    });
  });
});

describe("extractSourceIp (standalone, for public-route reuse)", () => {
  it("returns the rightmost non-empty trimmed entry", () => {
    expect(extractSourceIp("1.2.3.4, 5.6.7.8")).toBe("5.6.7.8");
  });

  it("skips trailing-comma empties to find the last real entry", () => {
    // Defensive — a buggy gateway/proxy might leave a trailing empty.
    // We should still surface the last real IP, not "unknown".
    expect(extractSourceIp("1.2.3.4, 5.6.7.8, ")).toBe("5.6.7.8");
  });

  it("returns 'unknown' for null / undefined / empty / just-separators", () => {
    expect(extractSourceIp(null)).toBe("unknown");
    expect(extractSourceIp(undefined)).toBe("unknown");
    expect(extractSourceIp("")).toBe("unknown");
    expect(extractSourceIp(" , ")).toBe("unknown");
  });
});
