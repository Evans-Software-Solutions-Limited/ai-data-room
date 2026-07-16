// Unit tests for `authorizeOrgAccess` + `isAuthFailure` — the
// shared cross-org + role-check helper used by every org-scoped
// protected handler.
//
// Tenant-isolation (slice 10) / T-004: the `membershipRepo` dep is now
// the caller's SCOPED membership repo (`ctx.scoped.membership`,
// already bound to the actor's org), so `findMember` takes only the
// user id — the org is implicit in the scope, not passed per-call.

import { describe, expect, it, vi } from "vitest";

import { OWNER_EDITOR, authorizeOrgAccess, isAuthFailure } from "../orgAccess";
import type { MembershipRepo } from "../../../../infrastructure/db/membershipRepo";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function makeRepo(): {
  membership: MembershipRepo;
  findMember: ReturnType<typeof vi.fn>;
} {
  const findMember = vi.fn();
  return {
    membership: { findMember } as unknown as MembershipRepo,
    findMember,
  };
}

const ACTOR = { localUserId: USER_ID, localOrgId: ORG_ID };

describe("authorizeOrgAccess", () => {
  it("returns 403 cross_org_access when paramOrgId mismatches actor.localOrgId", async () => {
    const { membership, findMember } = makeRepo();

    const result = await authorizeOrgAccess(
      { actor: ACTOR, paramOrgId: OTHER_ORG_ID },
      { membership },
    );

    // Cross-org check must short-circuit BEFORE the DB hit — an
    // attacker probing a different tenant's IDs shouldn't be able
    // to fingerprint membership-row existence via a timing channel.
    expect(findMember).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      code: 403,
      response: { ok: false, reason: "cross_org_access" },
    });
  });

  it("returns 403 not_member when there's no membership row for the actor", async () => {
    const { membership, findMember } = makeRepo();
    findMember.mockResolvedValue(null);

    const result = await authorizeOrgAccess(
      { actor: ACTOR, paramOrgId: ORG_ID },
      { membership },
    );

    expect(findMember).toHaveBeenCalledWith(USER_ID);
    expect(result).toMatchObject({
      code: 403,
      response: { ok: false, reason: "not_member" },
    });
  });

  it("returns 403 insufficient_role when the actor's role is not in the allowlist", async () => {
    const { membership, findMember } = makeRepo();
    findMember.mockResolvedValue({
      id: "membership_id",
      orgId: ORG_ID,
      userId: USER_ID,
      role: "viewer",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await authorizeOrgAccess(
      { actor: ACTOR, paramOrgId: ORG_ID },
      { membership },
    );

    expect(result).toMatchObject({
      code: 403,
      response: { ok: false, reason: "insufficient_role" },
    });
  });

  it("returns the membership when the actor is owner / editor (default allowlist)", async () => {
    const { membership, findMember } = makeRepo();
    const membershipRow = {
      id: "membership_id",
      orgId: ORG_ID,
      userId: USER_ID,
      role: "owner" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    findMember.mockResolvedValue(membershipRow);

    const result = await authorizeOrgAccess(
      { actor: ACTOR, paramOrgId: ORG_ID },
      { membership },
    );

    expect(result).toEqual(membershipRow);
    expect(isAuthFailure(result)).toBe(false);
  });

  it("respects a caller-supplied allowlist that broadens beyond OWNER_EDITOR", async () => {
    const { membership, findMember } = makeRepo();
    findMember.mockResolvedValue({
      id: "membership_id",
      orgId: ORG_ID,
      userId: USER_ID,
      role: "viewer",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Future handler that allows viewer members through.
    const result = await authorizeOrgAccess(
      { actor: ACTOR, paramOrgId: ORG_ID },
      { membership },
      ["owner", "editor", "viewer"],
    );

    expect(isAuthFailure(result)).toBe(false);
  });

  it("OWNER_EDITOR constant pins the v0.1 default to exactly owner + editor", () => {
    // Frozen-by-test pin — adding a role to the default allowlist
    // must be deliberate, not a silent broadening that grants
    // `viewer` users access to admin-tooling endpoints.
    expect(OWNER_EDITOR).toEqual(["owner", "editor"]);
  });
});

describe("isAuthFailure", () => {
  it("returns true for a status() short-circuit", async () => {
    const { membership } = makeRepo();
    const result = await authorizeOrgAccess(
      { actor: ACTOR, paramOrgId: OTHER_ORG_ID },
      { membership },
    );
    expect(isAuthFailure(result)).toBe(true);
  });

  it("returns false for an OrgMembership row", async () => {
    const { membership, findMember } = makeRepo();
    findMember.mockResolvedValue({
      id: "membership_id",
      orgId: ORG_ID,
      userId: USER_ID,
      role: "editor",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const result = await authorizeOrgAccess(
      { actor: ACTOR, paramOrgId: ORG_ID },
      { membership },
    );
    expect(isAuthFailure(result)).toBe(false);
  });
});
