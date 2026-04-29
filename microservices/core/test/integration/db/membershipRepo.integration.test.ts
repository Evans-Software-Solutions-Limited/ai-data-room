// Integration tests for `MembershipRepo`. Each test seeds an
// org + the necessary user(s) inline; no shared seed helper yet
// because the seed shape varies meaningfully per test.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";
import { schema } from "@ai-data-room/db";

import { MembershipRepo } from "../../../src/infrastructure/db/membershipRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

describe("MembershipRepo (integration)", () => {
  let memberships: MembershipRepo;
  let users: UserRepo;
  let orgs: OrgRepo;

  beforeAll(async () => {
    await applyMigrations();
    const db = drizzle(getTestPool(), { schema });
    memberships = new MembershipRepo(db);
    users = new UserRepo(db);
    orgs = new OrgRepo(db);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  it("create() inserts the (org, user, role) tuple", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "create");
    const m = await memberships.create({
      orgId: org.id,
      userId: user.id,
      role: "admin",
    });
    expect(m.orgId).toBe(org.id);
    expect(m.userId).toBe(user.id);
    expect(m.role).toBe("admin");
  });

  it("findByOrgUser() returns the membership when present and null otherwise", async () => {
    const { org, user } = await seedOrgAndUser(
      { orgs, users },
      "findbyorguser",
    );
    await memberships.create({
      orgId: org.id,
      userId: user.id,
      role: "internal",
    });

    const found = await memberships.findByOrgUser(org.id, user.id);
    expect(found?.role).toBe("internal");

    const missingUser = await memberships.findByOrgUser(
      org.id,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missingUser).toBeNull();
  });

  it("listByOrg() returns every membership for the org", async () => {
    const { org, user: user1 } = await seedOrgAndUser({ orgs, users }, "lista");
    const user2 = await users.create({
      workosUserId: "user_workos_listb",
      email: "listb@example.com",
    });
    await memberships.create({
      orgId: org.id,
      userId: user1.id,
      role: "owner",
    });
    await memberships.create({
      orgId: org.id,
      userId: user2.id,
      role: "admin",
    });

    const all = await memberships.listByOrg(org.id);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((m) => m.role))).toEqual(
      new Set(["owner", "admin"]),
    );
  });

  it("findOwnerForOrg() returns the single owner row, or null when none exists", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "findowner");
    expect(await memberships.findOwnerForOrg(org.id)).toBeNull();

    await memberships.create({ orgId: org.id, userId: user.id, role: "owner" });
    const owner = await memberships.findOwnerForOrg(org.id);
    expect(owner?.userId).toBe(user.id);
    expect(owner?.role).toBe("owner");
  });

  it("create() rejects a second owner on the same org (single-owner partial unique)", async () => {
    const { org, user: firstOwner } = await seedOrgAndUser(
      { orgs, users },
      "singleown",
    );
    const challenger = await users.create({
      workosUserId: "user_workos_challenger",
      email: "challenger@example.com",
    });
    await memberships.create({
      orgId: org.id,
      userId: firstOwner.id,
      role: "owner",
    });
    await expect(
      memberships.create({
        orgId: org.id,
        userId: challenger.id,
        role: "owner",
      }),
    ).rejects.toThrow(/org_memberships_single_owner_key/);
  });
});
