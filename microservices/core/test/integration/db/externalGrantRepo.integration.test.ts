// Integration tests for `ExternalGrantRepo`.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";
import { schema } from "@ai-data-room/db";

import { ExternalGrantRepo } from "../../../src/infrastructure/db/externalGrantRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

describe("ExternalGrantRepo (integration)", () => {
  let grants: ExternalGrantRepo;
  let users: UserRepo;
  let orgs: OrgRepo;

  beforeAll(async () => {
    await applyMigrations();
    const db = drizzle(getTestPool(), { schema });
    grants = new ExternalGrantRepo(db);
    users = new UserRepo(db);
    orgs = new OrgRepo(db);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  it("create() inserts a grant with status=active by default", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "create");
    const grant = await grants.create({
      orgId: org.id,
      userId: user.id,
      opportunitySlug: "vendor-a",
      grantedBy: user.id,
    });
    expect(grant.opportunitySlug).toBe("vendor-a");
    expect(grant.status).toBe("active");
  });

  it("listByUser() returns every grant for that user", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "listuser");
    await grants.create({
      orgId: org.id,
      userId: user.id,
      opportunitySlug: "vendor-a",
      grantedBy: user.id,
    });
    await grants.create({
      orgId: org.id,
      userId: user.id,
      opportunitySlug: "vendor-b",
      grantedBy: user.id,
    });
    const list = await grants.listByUser(user.id);
    expect(list).toHaveLength(2);
    expect(new Set(list.map((g) => g.opportunitySlug))).toEqual(
      new Set(["vendor-a", "vendor-b"]),
    );
  });

  it("listByOrg() returns every grant under the org regardless of grantee", async () => {
    const { org, user: granter } = await seedOrgAndUser(
      { orgs, users },
      "listorg",
    );
    const externalA = await users.create({
      workosUserId: "user_workos_extA",
      email: "extA@example.com",
    });
    const externalB = await users.create({
      workosUserId: "user_workos_extB",
      email: "extB@example.com",
    });
    await grants.create({
      orgId: org.id,
      userId: externalA.id,
      opportunitySlug: "vendor-a",
      grantedBy: granter.id,
    });
    await grants.create({
      orgId: org.id,
      userId: externalB.id,
      opportunitySlug: "vendor-b",
      grantedBy: granter.id,
    });
    const list = await grants.listByOrg(org.id);
    expect(list).toHaveLength(2);
    expect(new Set(list.map((g) => g.userId))).toEqual(
      new Set([externalA.id, externalB.id]),
    );
  });
});
