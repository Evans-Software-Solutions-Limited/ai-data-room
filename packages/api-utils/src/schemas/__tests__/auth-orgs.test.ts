import { describe, expect, it } from "vitest";

import {
  AuditEventSchema,
  AuditEventTypeSchema,
  AuditOutcomeSchema,
  ExternalAccessGrantSchema,
  ExternalAccessGrantStatusSchema,
  InvitationKindSchema,
  InvitationRoleSchema,
  InvitationSchema,
  InvitationStateSchema,
  LifecycleStateSchema,
  OrgMembershipSchema,
  OrgSchema,
  RoleSchema,
  UserSchema,
} from "../auth-orgs";

// Stable fixtures — keeps each test focused on the schema-under-test
// rather than the boilerplate of building a valid object.
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
const INVITATION_ID = "55555555-5555-4555-8555-555555555555";
const AUDIT_ID = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-04-23T10:00:00Z").toISOString();

// ─── Primitive enums ───────────────────────────────────────────────────

// Each enum gets the same shape of test (accepts every valid value;
// rejects a value chosen to be "plausibly wrong"). The rejected value
// per row is significant: it documents the boundary we're guarding —
// e.g. RoleSchema rejects "external" because externals have grants
// not memberships; InvitationRoleSchema rejects "owner" because
// ownership is established at signup, never via invite.
describe.each([
  {
    name: "RoleSchema",
    schema: RoleSchema,
    valid: ["owner", "editor", "viewer"],
    invalid: "external",
    invalidReason: "externals have grants, not memberships",
  },
  {
    name: "LifecycleStateSchema",
    schema: LifecycleStateSchema,
    valid: ["active", "suspended", "deleted"],
    invalid: "archived",
    invalidReason: "no archive state at v0.1",
  },
  {
    name: "AuditOutcomeSchema",
    schema: AuditOutcomeSchema,
    valid: ["success", "failure"],
    invalid: "pending",
    invalidReason: "outcome is binary at write time",
  },
  {
    name: "InvitationKindSchema",
    schema: InvitationKindSchema,
    valid: ["internal", "external"],
    invalid: "editor",
    invalidReason: "kind is not a role",
  },
  {
    name: "InvitationStateSchema",
    schema: InvitationStateSchema,
    valid: ["pending", "accepted", "revoked", "expired"],
    invalid: "draft",
    invalidReason: "WorkOS issues invites in 'pending' directly",
  },
  {
    name: "InvitationRoleSchema",
    schema: InvitationRoleSchema,
    valid: ["editor", "viewer"],
    invalid: "owner",
    invalidReason: "ownership is established at signup, never via invite",
  },
  {
    name: "ExternalAccessGrantStatusSchema",
    schema: ExternalAccessGrantStatusSchema,
    valid: ["active", "revoked", "expired"],
    invalid: "pending",
    invalidReason:
      "grants don't have a pending state — they're active on creation, with `expired` reserved for slice-3's lazy transition",
  },
])("$name", ({ schema, valid, invalid, invalidReason }) => {
  it.each(valid)("accepts %s", (value) => {
    expect(schema.parse(value)).toBe(value);
  });

  it(`rejects '${invalid}' — ${invalidReason}`, () => {
    expect(() => schema.parse(invalid)).toThrow();
  });
});

// ─── FR24 exhaustiveness ───────────────────────────────────────────────

describe("AuditEventTypeSchema (FR24 exhaustiveness)", () => {
  // The 21 event types listed in requirements.md FR24, in the order
  // they appear in the FR. Reordering is allowed in the schema, but
  // the *set* must match — any drift here means either the schema or
  // the spec changed without the other.
  const FR24_EVENT_TYPES = [
    "signup",
    "email_verified",
    "login_success",
    "login_failure",
    "mfa_challenge_issued",
    "mfa_success",
    "mfa_failure",
    "logout",
    "invite_sent",
    "invite_accepted",
    "invite_revoked",
    "invite_expired",
    "password_reset_requested",
    "password_reset_completed",
    "mfa_enrolled",
    "mfa_removed",
    "recovery_code_used",
    "role_changed",
    "user_suspended",
    "user_unsuspended",
    "user_deleted",
  ] as const;

  it("declares exactly 21 event types (FR24 'all of:' list)", () => {
    expect(AuditEventTypeSchema.options).toHaveLength(21);
    expect(FR24_EVENT_TYPES).toHaveLength(21);
  });

  it("covers every FR24 event type", () => {
    for (const type of FR24_EVENT_TYPES) {
      expect(AuditEventTypeSchema.parse(type)).toBe(type);
    }
  });

  it("declares no extra event types beyond FR24", () => {
    const declared = new Set(AuditEventTypeSchema.options);
    const required = new Set(FR24_EVENT_TYPES);
    for (const type of declared) {
      expect(required.has(type as (typeof FR24_EVENT_TYPES)[number])).toBe(
        true,
      );
    }
  });

  it("rejects unknown event types", () => {
    expect(() => AuditEventTypeSchema.parse("user_archived")).toThrow();
  });
});

// ─── Aggregates ────────────────────────────────────────────────────────

describe("OrgSchema", () => {
  const validOrg = {
    id: ORG_ID,
    workosOrgId: "org_workos_abc",
    name: "Capital Pay",
    slug: "capital-pay",
    status: "active" as const,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("parses a valid organization", () => {
    const parsed = OrgSchema.parse(validOrg);
    expect(parsed.slug).toBe("capital-pay");
    expect(parsed.createdAt).toBeInstanceOf(Date);
  });

  it("rejects a slug with uppercase letters", () => {
    expect(() =>
      OrgSchema.parse({ ...validOrg, slug: "Capital-Pay" }),
    ).toThrow();
  });
});

describe("UserSchema", () => {
  const validUser = {
    id: USER_ID,
    workosUserId: "user_workos_xyz",
    email: "alice@example.com",
    fullName: "Alice Example",
    lifecycleState: "active" as const,
    emailVerifiedAt: NOW,
    mfaEnrolledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("parses a valid user", () => {
    const parsed = UserSchema.parse(validUser);
    expect(parsed.email).toBe("alice@example.com");
    expect(parsed.mfaEnrolledAt).toBeNull();
  });

  it("allows email/fullName=null for GDPR-deleted users (NFR9)", () => {
    const tombstone = UserSchema.parse({
      ...validUser,
      email: null,
      fullName: null,
      lifecycleState: "deleted" as const,
    });
    expect(tombstone.workosUserId).toBe("user_workos_xyz");
  });

  it("rejects a malformed email", () => {
    expect(() =>
      UserSchema.parse({ ...validUser, email: "not-an-email" }),
    ).toThrow();
  });
});

describe("OrgMembershipSchema", () => {
  const validMembership = {
    id: MEMBERSHIP_ID,
    orgId: ORG_ID,
    userId: USER_ID,
    role: "editor" as const,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("parses a valid membership", () => {
    expect(OrgMembershipSchema.parse(validMembership).role).toBe("editor");
  });

  it("rejects role='external' (externals have grants, not memberships)", () => {
    expect(() =>
      OrgMembershipSchema.parse({ ...validMembership, role: "external" }),
    ).toThrow();
  });
});

describe("ExternalAccessGrantSchema", () => {
  const validGrant = {
    id: GRANT_ID,
    orgId: ORG_ID,
    userId: USER_ID,
    opportunitySlug: "vendor-a",
    grantedBy: USER_ID,
    status: "active" as const,
    expiresAt: new Date(
      new Date(NOW).getTime() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("parses a valid grant", () => {
    expect(ExternalAccessGrantSchema.parse(validGrant).opportunitySlug).toBe(
      "vendor-a",
    );
  });

  it("rejects an empty opportunitySlug", () => {
    expect(() =>
      ExternalAccessGrantSchema.parse({ ...validGrant, opportunitySlug: "" }),
    ).toThrow();
  });

  it("requires expiresAt — FR8b", () => {
    const grantWithoutExpiry: Partial<typeof validGrant> = { ...validGrant };
    delete grantWithoutExpiry.expiresAt;
    expect(() => ExternalAccessGrantSchema.parse(grantWithoutExpiry)).toThrow();
  });
});

describe("InvitationSchema", () => {
  const internalInvite = {
    id: INVITATION_ID,
    workosInvitationId: "inv_workos_abc",
    orgId: ORG_ID,
    email: "bob@example.com",
    kind: "internal" as const,
    role: "viewer" as const,
    opportunitySlug: null,
    invitedBy: USER_ID,
    state: "pending" as const,
    expiresAt: NOW,
    acceptedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const externalInvite = {
    ...internalInvite,
    kind: "external" as const,
    role: null,
    opportunitySlug: "vendor-a",
  };

  it("parses a valid internal invitation", () => {
    expect(InvitationSchema.parse(internalInvite).kind).toBe("internal");
  });

  it("parses a valid external invitation", () => {
    expect(InvitationSchema.parse(externalInvite).opportunitySlug).toBe(
      "vendor-a",
    );
  });

  it("rejects an internal invitation missing a role", () => {
    expect(() =>
      InvitationSchema.parse({ ...internalInvite, role: null }),
    ).toThrow(/internal invitations must specify a role/);
  });

  it("rejects an internal invitation that carries an opportunitySlug", () => {
    expect(() =>
      InvitationSchema.parse({
        ...internalInvite,
        opportunitySlug: "vendor-a",
      }),
    ).toThrow(/internal invitations must not carry an opportunitySlug/);
  });

  it("rejects an external invitation missing the opportunitySlug", () => {
    expect(() =>
      InvitationSchema.parse({ ...externalInvite, opportunitySlug: null }),
    ).toThrow(/external invitations must carry an opportunitySlug/);
  });

  it("rejects an external invitation that carries a role", () => {
    expect(() =>
      InvitationSchema.parse({ ...externalInvite, role: "viewer" }),
    ).toThrow(/external invitations must not specify a role/);
  });
});

describe("AuditEventSchema", () => {
  const validEvent = {
    id: AUDIT_ID,
    occurredAt: NOW,
    eventType: "login_success" as const,
    actorUserId: USER_ID,
    targetUserId: USER_ID,
    orgId: ORG_ID,
    sourceIp: "203.0.113.5",
    userAgent: "Mozilla/5.0",
    outcome: "success" as const,
    metadata: { workosSessionId: "sess_abc" },
  };

  it("parses a valid audit event", () => {
    const parsed = AuditEventSchema.parse(validEvent);
    expect(parsed.eventType).toBe("login_success");
    expect(parsed.metadata.workosSessionId).toBe("sess_abc");
  });

  it("allows null actor / target / org for pre-auth events (e.g. signup)", () => {
    const preAuth = AuditEventSchema.parse({
      ...validEvent,
      eventType: "signup",
      actorUserId: null,
      targetUserId: null,
      orgId: null,
    });
    expect(preAuth.actorUserId).toBeNull();
  });

  it("rejects a non-IP sourceIp", () => {
    expect(() =>
      AuditEventSchema.parse({ ...validEvent, sourceIp: "not-an-ip" }),
    ).toThrow();
  });
});
