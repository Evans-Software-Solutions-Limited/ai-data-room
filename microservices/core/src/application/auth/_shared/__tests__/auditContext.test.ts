// Unit tests for `buildAuditContext` — extracts `sourceIp` +
// `userAgent` from request headers in the shape every audit-emitting
// application function expects.

import { describe, expect, it } from "vitest";

import { buildAuditContext } from "../auditContext";

describe("buildAuditContext", () => {
  it("returns the leftmost IP from x-forwarded-for", () => {
    expect(
      buildAuditContext({
        "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178",
        "user-agent": "Mozilla/5.0 ...",
      }),
    ).toEqual({
      sourceIp: "203.0.113.5",
      userAgent: "Mozilla/5.0 ...",
    });
  });

  it("trims whitespace around the leftmost x-forwarded-for entry", () => {
    expect(
      buildAuditContext({
        "x-forwarded-for": " 203.0.113.5 , 70.41.3.18 ",
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
