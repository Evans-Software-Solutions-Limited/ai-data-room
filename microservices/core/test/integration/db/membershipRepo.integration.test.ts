// Integration tests for `MembershipRepo`. Each test seeds an
// org + the necessary user(s) inline; no shared seed helper yet
// because the seed shape varies meaningfully per test.
//
// Tenant-isolation (slice 10) / T-004: `MembershipRepo` is now a
// `ScopedRepo` subclass — the org is bound at construction, so each
// test constructs its own repo instance AFTER seeding the org it
// needs (there's no longer one shared `memberships` instance for the
// whole file). `findByUser` / `lockForUserCreate` moved to
// `bootstrapRepo.test.ts` (they run before a tenant context exists,
// so they were never org-scoped to begin with).

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

import { MembershipRepo } from "../../../src/infrastructure/db/membershipRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

describe("MembershipRepo (integration)", () => {
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

  it("create() inserts the (org, user, role) tuple, stamping the bound org", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "create");
    const memberships = new MembershipRepo(db, org.id);
    const m = await memberships.create({ userId: user.id, role: "editor" });
    expect(m.orgId).toBe(org.id);
    expect(m.userId).toBe(user.id);
    expect(m.role).toBe("editor");
  });

  it("findMember() returns the membership when present and null otherwise", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "findmember");
    const memberships = new MembershipRepo(db, org.id);
    await memberships.create({ userId: user.id, role: "viewer" });

    const found = await memberships.findMember(user.id);
    expect(found?.role).toBe("viewer");

    const missingUser = await memberships.findMember(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missingUser).toBeNull();
  });

  it("list() returns every membership for the bound org", async () => {
    const { org, user: user1 } = await seedOrgAndUser({ orgs, users }, "lista");
    const user2 = await users.create({
      workosUserId: "user_workos_listb",
      email: "listb@example.com",
    });
    const memberships = new MembershipRepo(db, org.id);
    await memberships.create({ userId: user1.id, role: "owner" });
    await memberships.create({ userId: user2.id, role: "editor" });

    const all = await memberships.list();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((m) => m.role))).toEqual(
      new Set(["owner", "editor"]),
    );
  });

  it("findOwner() returns the single owner row, or null when none exists", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "findowner");
    const memberships = new MembershipRepo(db, org.id);
    expect(await memberships.findOwner()).toBeNull();

    await memberships.create({ userId: user.id, role: "owner" });
    const owner = await memberships.findOwner();
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
    const memberships = new MembershipRepo(db, org.id);
    await memberships.create({ userId: firstOwner.id, role: "owner" });
    await expect(
      memberships.create({ userId: challenger.id, role: "owner" }),
    ).rejects.toThrow(/org_memberships_single_owner_key/);
  });
});
