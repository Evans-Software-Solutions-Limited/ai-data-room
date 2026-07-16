// Integration tests for `ExternalGrantRepo`.
//
// Tenant-isolation (slice 10) / T-004: `ExternalGrantRepo` is now a
// `ScopedRepo` subclass — each test constructs its own instance bound
// to the org it seeds. `listByUser` moved to `bootstrapRepo.test.ts`
// (an external user's self-read has to work with no org context).

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

import { ExternalGrantRepo } from "../../../src/infrastructure/db/externalGrantRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

describe("ExternalGrantRepo (integration)", () => {
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

  // FR8b — repo's `create()` requires an explicit expiresAt. The DB
  // also carries a column-level default (`NOW() + 90 days`) as a
  // defence-in-depth backstop; we still pass the value explicitly
  // here so the test exercises the application-layer policy path.
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const ninetyDaysFromNow = () => new Date(Date.now() + NINETY_DAYS_MS);

  it("create() inserts a grant with status=active by default, stamping the bound org", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "create");
    const grants = new ExternalGrantRepo(db, org.id);
    const grant = await grants.create({
      userId: user.id,
      opportunitySlug: "vendor-a",
      grantedBy: user.id,
      expiresAt: ninetyDaysFromNow(),
    });
    expect(grant.orgId).toBe(org.id);
    expect(grant.opportunitySlug).toBe("vendor-a");
    expect(grant.status).toBe("active");
    // FR8b: the row carries the caller-supplied expiry within ~5s.
    const driftMs = Math.abs(
      grant.expiresAt.getTime() - (Date.now() + NINETY_DAYS_MS),
    );
    expect(driftMs).toBeLessThan(5_000);
  });

  it("list() returns every grant under the bound org regardless of grantee, and excludes other orgs", async () => {
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
    const grants = new ExternalGrantRepo(db, org.id);
    await grants.create({
      userId: externalA.id,
      opportunitySlug: "vendor-a",
      grantedBy: granter.id,
      expiresAt: ninetyDaysFromNow(),
    });
    await grants.create({
      userId: externalB.id,
      opportunitySlug: "vendor-b",
      grantedBy: granter.id,
      expiresAt: ninetyDaysFromNow(),
    });

    // A second org's grants must never show up in the first org's list.
    const { org: otherOrg, user: otherGranter } = await seedOrgAndUser(
      { orgs, users },
      "listorg_other",
    );
    const otherGrants = new ExternalGrantRepo(db, otherOrg.id);
    await otherGrants.create({
      userId: otherGranter.id,
      opportunitySlug: "vendor-c",
      grantedBy: otherGranter.id,
      expiresAt: ninetyDaysFromNow(),
    });

    const list = await grants.list();
    expect(list).toHaveLength(2);
    expect(new Set(list.map((g) => g.userId))).toEqual(
      new Set([externalA.id, externalB.id]),
    );
  });
});
