// Integration tests for `OrgRepo`. Conventions per
// `userRepo.integration.test.ts`.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";
import { schema } from "@ai-data-room/db";

import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";

describe("OrgRepo (integration)", () => {
  let repo: OrgRepo;

  beforeAll(async () => {
    await applyMigrations();
    const db = drizzle(getTestPool(), { schema });
    repo = new OrgRepo(db);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  it("create() inserts a row with status=active by default", async () => {
    const org = await repo.create({
      workosOrgId: "org_workos_create",
      name: "Capital Pay",
      slug: "capital-pay",
    });
    expect(org.status).toBe("active");
    expect(org.slug).toBe("capital-pay");
  });

  it("findById() returns the row when present and null otherwise", async () => {
    const inserted = await repo.create({
      workosOrgId: "org_workos_findbyid",
      name: "By ID",
      slug: "by-id",
    });
    const fetched = await repo.findById(inserted.id);
    expect(fetched?.id).toBe(inserted.id);

    const missing = await repo.findById("00000000-0000-4000-8000-000000000000");
    expect(missing).toBeNull();
  });

  it("findByWorkosOrgId() exchanges a WorkOS Org ID for our row", async () => {
    await repo.create({
      workosOrgId: "org_workos_lookup",
      name: "Lookup Co",
      slug: "lookup-co",
    });
    const found = await repo.findByWorkosOrgId("org_workos_lookup");
    expect(found?.slug).toBe("lookup-co");

    const missing = await repo.findByWorkosOrgId("org_workos_does_not_exist");
    expect(missing).toBeNull();
  });

  it("findBySlug() returns the matching org or null", async () => {
    await repo.create({
      workosOrgId: "org_workos_slug",
      name: "Slug Co",
      slug: "slug-co",
    });
    const found = await repo.findBySlug("slug-co");
    expect(found?.workosOrgId).toBe("org_workos_slug");

    const missing = await repo.findBySlug("does-not-exist");
    expect(missing).toBeNull();
  });
});
