// Unit tests for the org-provisioning (slice 17) schemas — the
// create-org request DTO and the `org.created` event payload.

import { describe, expect, it } from "vitest";

import {
  CreateOrgInputSchema,
  OrgCreatedEventSchema,
  ORG_CREATED_DETAIL_TYPE,
} from "../org";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

describe("CreateOrgInputSchema (FR1)", () => {
  it("accepts a 1–80 char name", () => {
    expect(CreateOrgInputSchema.parse({ name: "Acme Ltd" })).toEqual({
      name: "Acme Ltd",
    });
  });

  it("trims surrounding whitespace before validating", () => {
    expect(CreateOrgInputSchema.parse({ name: "  Acme Ltd  " })).toEqual({
      name: "Acme Ltd",
    });
  });

  it("accepts exactly 80 characters (boundary)", () => {
    const name = "a".repeat(80);
    expect(CreateOrgInputSchema.parse({ name }).name).toBe(name);
  });

  it("rejects an empty name", () => {
    expect(() => CreateOrgInputSchema.parse({ name: "" })).toThrow();
  });

  it("rejects a whitespace-only name (trims to empty)", () => {
    expect(() => CreateOrgInputSchema.parse({ name: "   " })).toThrow();
  });

  it("rejects a name longer than 80 characters", () => {
    expect(() =>
      CreateOrgInputSchema.parse({ name: "a".repeat(81) }),
    ).toThrow();
  });

  it("rejects a missing or non-string name", () => {
    expect(() => CreateOrgInputSchema.parse({})).toThrow();
    expect(() => CreateOrgInputSchema.parse({ name: 42 })).toThrow();
  });
});

describe("OrgCreatedEventSchema + ORG_CREATED_DETAIL_TYPE (FR3)", () => {
  const validEvent = {
    orgId: ORG_ID,
    workosOrgId: "org_workos_abc",
    ownerUserId: USER_ID,
  };

  it("uses the dotted EventBridge detail-type", () => {
    expect(ORG_CREATED_DETAIL_TYPE).toBe("org.created");
  });

  it("parses a valid payload", () => {
    expect(OrgCreatedEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it("rejects a non-UUID orgId", () => {
    expect(() =>
      OrgCreatedEventSchema.parse({ ...validEvent, orgId: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects an empty workosOrgId", () => {
    expect(() =>
      OrgCreatedEventSchema.parse({ ...validEvent, workosOrgId: "" }),
    ).toThrow();
  });

  it("rejects a missing ownerUserId", () => {
    expect(() =>
      OrgCreatedEventSchema.parse({
        orgId: ORG_ID,
        workosOrgId: "org_workos_abc",
      }),
    ).toThrow();
  });
});
