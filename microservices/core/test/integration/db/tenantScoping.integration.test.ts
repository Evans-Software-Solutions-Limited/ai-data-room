// Tenant-isolation (slice 10) / T-004 — REQUIRED regression test.
//
// The load-bearing point of this backfill (AC-US1 / NFR1): seed TWO
// distinct orgs, each with a row in every backfilled tenant-scoped
// table, then prove a read under org A's `scopedRepo(orgA, db)`
// context returns ONLY org A's rows — org B's rows are never present,
// across `membership`, `invitations`, and `externalGrants`.
//
// This is deliberately a much smaller claim than the full property
// test (T-006, fast-check, generates random org pairs across every
// method) — this file pins the specific scenario the task asked for
// and is cheap enough to run on every PR; T-006 is tracked separately.
//
// Manual revert-check performed during development (per the task's
// instructions): temporarily commented out the org predicate in
// `MembershipRepo.list()` (`this.scoped(orgMemberships.orgId)` →
// unconditional `undefined`/no WHERE) and re-ran this file — the
// "membership.list() returns only org A's row" assertion below FAILED
// (org B's row leaked in), proving the test actually depends on
// scoping rather than on the seed happening to have one org each. The
// predicate was restored immediately afterward and the full file was
// re-run green before this diff was finalised — no temporary breakage
// is present in the committed code.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";
import { schema } from "@ai-data-room/db";

import { scopedRepo } from "../../../src/infrastructure/db/scoped";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe("Cross-tenant isolation regression (T-004, AC-US1)", () => {
  let db: PostgresJsDatabase<typeof schema>;
  let users: UserRepo;
  let orgs: OrgRepo;

  beforeAll(async () => {
    await applyMigrations();
    db = drizzle(getTestPool(), { schema });
    users = new UserRepo(db);
    orgs = new OrgRepo(db);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  it("scoped reads under org A return only org A's rows across membership, invitations, and externalGrants", async () => {
    // 1. Seed two distinct orgs, each with a user, a membership, an
    // invitation, and an external access grant.
    const { org: orgA, user: userA } = await seedOrgAndUser(
      { orgs, users },
      "tenantscope_a",
    );
    const { org: orgB, user: userB } = await seedOrgAndUser(
      { orgs, users },
      "tenantscope_b",
    );

    const scopedA = scopedRepo(orgA.id, db);
    const scopedB = scopedRepo(orgB.id, db);

    await scopedA.membership.create({ userId: userA.id, role: "owner" });
    await scopedB.membership.create({ userId: userB.id, role: "owner" });

    await scopedA.invitations.create({
      workosInvitationId: "inv_workos_tenantscope_a",
      email: "invitee-a@example.com",
      kind: "internal",
      role: "viewer",
      opportunitySlug: null,
      invitedBy: userA.id,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    });
    await scopedB.invitations.create({
      workosInvitationId: "inv_workos_tenantscope_b",
      email: "invitee-b@example.com",
      kind: "internal",
      role: "viewer",
      opportunitySlug: null,
      invitedBy: userB.id,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
    });

    await scopedA.externalGrants.create({
      userId: userA.id,
      opportunitySlug: "vendor-a",
      grantedBy: userA.id,
      expiresAt: new Date(Date.now() + NINETY_DAYS_MS),
    });
    await scopedB.externalGrants.create({
      userId: userB.id,
      opportunitySlug: "vendor-b",
      grantedBy: userB.id,
      expiresAt: new Date(Date.now() + NINETY_DAYS_MS),
    });

    // 2 + 3. Read under org A's scope; assert ONLY org A's rows come
    // back — org B's rows must be absent, not just "not first".
    const membershipList = await scopedA.membership.list();
    expect(membershipList).toHaveLength(1);
    expect(membershipList[0]?.userId).toBe(userA.id);
    expect(membershipList.some((m) => m.orgId === orgB.id)).toBe(false);

    const invitationList = await scopedA.invitations.listByState("pending");
    expect(invitationList).toHaveLength(1);
    expect(invitationList[0]?.email).toBe("invitee-a@example.com");
    expect(invitationList.some((i) => i.orgId === orgB.id)).toBe(false);

    const grantList = await scopedA.externalGrants.list();
    expect(grantList).toHaveLength(1);
    expect(grantList[0]?.opportunitySlug).toBe("vendor-a");
    expect(grantList.some((g) => g.orgId === orgB.id)).toBe(false);

    // Symmetric check the other direction — org B's scope must never
    // see org A's rows either.
    expect(await scopedB.membership.list()).toEqual([
      expect.objectContaining({ userId: userB.id }),
    ]);
    expect(await scopedB.invitations.listByState("pending")).toEqual([
      expect.objectContaining({ email: "invitee-b@example.com" }),
    ]);
    expect(await scopedB.externalGrants.list()).toEqual([
      expect.objectContaining({ opportunitySlug: "vendor-b" }),
    ]);
  });
});
