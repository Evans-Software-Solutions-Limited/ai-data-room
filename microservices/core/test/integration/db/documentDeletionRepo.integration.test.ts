// Integration tests for `DocumentDeletionRepo`.
//
// room-and-folders (slice 2) / T-004: `DocumentDeletionRepo` is a
// `ScopedRepo` subclass — the org is bound at construction. The table
// has no FK to `documents` (it outlives the hard-deleted row), so
// tests use a free UUID for `documentId` rather than seeding a real
// document.

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

import { DocumentDeletionRepo } from "../../../src/infrastructure/db/documentDeletionRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

const FREE_DOCUMENT_ID = "00000000-0000-4000-8000-000000000abc";

describe("DocumentDeletionRepo (integration)", () => {
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

  it("create() inserts and stamps the bound org, with a Date hardDeletedAt", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "create");
    const deletions = new DocumentDeletionRepo(db, org.id);

    const record = await deletions.create({
      documentId: FREE_DOCUMENT_ID,
      softDeletedBy: user.id,
    });

    expect(record.orgId).toBe(org.id);
    expect(record.documentId).toBe(FREE_DOCUMENT_ID);
    expect(record.hardDeletedAt).toBeInstanceOf(Date);
  });

  it("findById() returns the row, or null for an unknown id", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "findbyid");
    const deletions = new DocumentDeletionRepo(db, org.id);
    const record = await deletions.create({
      documentId: FREE_DOCUMENT_ID,
      softDeletedBy: user.id,
    });

    const found = await deletions.findById(record.id);
    expect(found?.id).toBe(record.id);

    const missing = await deletions.findById(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing).toBeNull();
  });

  it("listByDocument() returns records for that document oldest-first, or an empty array for an unknown document", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "listbydoc");
    const deletions = new DocumentDeletionRepo(db, org.id);

    const first = await deletions.create({
      documentId: FREE_DOCUMENT_ID,
      softDeletedBy: user.id,
    });
    const second = await deletions.create({
      documentId: FREE_DOCUMENT_ID,
      softDeletedBy: user.id,
    });

    const list = await deletions.listByDocument(FREE_DOCUMENT_ID);
    expect(list.map((r) => r.id)).toEqual([first.id, second.id]);

    const empty = await deletions.listByDocument(
      "00000000-0000-4000-8000-000000000fff",
    );
    expect(empty).toEqual([]);
  });

  it("scopes every read/list to the bound org — a foreign-org record is invisible", async () => {
    const { org: orgA } = await seedOrgAndUser({ orgs, users }, "isoa");
    const { org: orgB, user: userB } = await seedOrgAndUser(
      { orgs, users },
      "isob",
    );
    const deletionsA = new DocumentDeletionRepo(db, orgA.id);
    const deletionsB = new DocumentDeletionRepo(db, orgB.id);

    const recordB = await deletionsB.create({
      documentId: FREE_DOCUMENT_ID,
      softDeletedBy: userB.id,
    });

    expect(await deletionsA.findById(recordB.id)).toBeNull();
    expect(await deletionsA.listByDocument(FREE_DOCUMENT_ID)).toEqual([]);
  });
});
