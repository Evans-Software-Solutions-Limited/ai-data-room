// Integration tests for `OpportunityRepo`.
//
// room-and-folders (slice 2) / T-004: `OpportunityRepo` is a
// `ScopedRepo` subclass — the org is bound at construction, so each
// test seeds the org(s) it needs and constructs its own repo
// instance(s) afterwards.

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

import { OpportunityRepo } from "../../../src/infrastructure/db/opportunityRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

describe("OpportunityRepo (integration)", () => {
  let db: PostgresJsDatabase<typeof schema>;
  let users: UserRepo;
  let orgs: OrgRepo;

  beforeAll(async () => {
    await applyMigrations();
    db = drizzle(getTestPool(), { schema });
    orgs = new OrgRepo(db);
    users = new UserRepo(db);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  it("create() inserts and stamps the bound org", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "create");
    const opportunities = new OpportunityRepo(db, org.id);
    const opp = await opportunities.create({
      slug: "Vendor_A",
      name: "Vendor A",
      createdBy: user.id,
    });
    expect(opp.orgId).toBe(org.id);
    expect(opp.status).toBe("active");
    expect(opp.slug).toBe("Vendor_A");
  });

  it("findById() returns the row, or null for an unknown id", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "findbyid");
    const opportunities = new OpportunityRepo(db, org.id);
    const opp = await opportunities.create({
      slug: "Vendor_B",
      name: "Vendor B",
      createdBy: user.id,
    });

    const found = await opportunities.findById(opp.id);
    expect(found?.id).toBe(opp.id);

    const missing = await opportunities.findById(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing).toBeNull();
  });

  it("findBySlug() returns the row by slug, or null when absent", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "findbyslug");
    const opportunities = new OpportunityRepo(db, org.id);
    await opportunities.create({
      slug: "Vendor_C",
      name: "Vendor C",
      createdBy: user.id,
    });

    const found = await opportunities.findBySlug("Vendor_C");
    expect(found?.slug).toBe("Vendor_C");

    const missing = await opportunities.findBySlug("Vendor_Nonexistent");
    expect(missing).toBeNull();
  });

  it("listActive() returns only active opportunities, ordered by slug ascending", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "listactive");
    const opportunities = new OpportunityRepo(db, org.id);
    await opportunities.create({
      slug: "Bravo",
      name: "Bravo",
      createdBy: user.id,
    });
    await opportunities.create({
      slug: "Alpha",
      name: "Alpha",
      createdBy: user.id,
    });
    const archived = await opportunities.create({
      slug: "Zulu",
      name: "Zulu",
      createdBy: user.id,
    });
    await opportunities.archive(archived.id);

    const active = await opportunities.listActive();
    expect(active.map((o) => o.slug)).toEqual(["Alpha", "Bravo"]);
  });

  it("rename() updates slug + name and returns the row, or null for an unknown id", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "rename");
    const opportunities = new OpportunityRepo(db, org.id);
    const opp = await opportunities.create({
      slug: "Old_Slug",
      name: "Old Name",
      createdBy: user.id,
    });

    const renamed = await opportunities.rename(opp.id, {
      slug: "New_Slug",
      name: "New Name",
    });
    expect(renamed?.slug).toBe("New_Slug");
    expect(renamed?.name).toBe("New Name");

    const missing = await opportunities.rename(
      "00000000-0000-4000-8000-000000000000",
      { slug: "X", name: "X" },
    );
    expect(missing).toBeNull();
  });

  it("archive() sets status + archivedAt, is compare-and-set on active, and null for unknown id", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "archive");
    const opportunities = new OpportunityRepo(db, org.id);
    const opp = await opportunities.create({
      slug: "To_Archive",
      name: "To Archive",
      createdBy: user.id,
    });

    const archived = await opportunities.archive(opp.id);
    expect(archived?.status).toBe("archived");
    expect(archived?.archivedAt).not.toBeNull();

    const secondArchive = await opportunities.archive(opp.id);
    expect(secondArchive).toBeNull();

    const missing = await opportunities.archive(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing).toBeNull();
  });

  it("listArchivedBefore() returns only archived opportunities whose archivedAt precedes the cutoff", async () => {
    const { org, user } = await seedOrgAndUser(
      { orgs, users },
      "listarchivedbefore",
    );
    const opportunities = new OpportunityRepo(db, org.id);

    const old = await opportunities.create({
      slug: "Old_Archived",
      name: "Old Archived",
      createdBy: user.id,
    });
    await opportunities.archive(old.id, new Date("2020-01-01"));

    const recentlyArchived = await opportunities.create({
      slug: "Recently_Archived",
      name: "Recently Archived",
      createdBy: user.id,
    });
    await opportunities.archive(recentlyArchived.id, new Date());

    await opportunities.create({
      slug: "Still_Active",
      name: "Still Active",
      createdBy: user.id,
    });

    const cutoff = new Date("2021-01-01");
    const results = await opportunities.listArchivedBefore(cutoff);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(old.id);
  });

  it("scopes every read/list to the bound org — a foreign-org row is invisible", async () => {
    const { org: orgA } = await seedOrgAndUser({ orgs, users }, "isoa");
    const { org: orgB, user: userB } = await seedOrgAndUser(
      { orgs, users },
      "isob",
    );
    const opportunitiesA = new OpportunityRepo(db, orgA.id);
    const opportunitiesB = new OpportunityRepo(db, orgB.id);

    const oppB = await opportunitiesB.create({
      slug: "Org_B_Deal",
      name: "Org B Deal",
      createdBy: userB.id,
    });

    expect(await opportunitiesA.findById(oppB.id)).toBeNull();
    expect(await opportunitiesA.findBySlug("Org_B_Deal")).toBeNull();
    expect(await opportunitiesA.listActive()).toEqual([]);
  });
});
