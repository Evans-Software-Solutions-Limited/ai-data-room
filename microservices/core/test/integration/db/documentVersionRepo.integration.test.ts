// Integration tests for `DocumentVersionRepo`.
//
// room-and-folders (slice 2) / T-004: `DocumentVersionRepo` is a
// `ScopedRepo` subclass — the org is bound at construction. This repo
// also owns the `sha256` bytea <-> hex mapping (see the file header on
// `documentVersionRepo.ts`), so `create`/`findById` assert the
// round-trip explicitly.

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

import { DocumentVersionRepo } from "../../../src/infrastructure/db/documentVersionRepo";
import { DocumentRepo } from "../../../src/infrastructure/db/documentRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

describe("DocumentVersionRepo (integration)", () => {
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

  it("create() inserts a version, round-tripping sha256 through bytea", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "create");
    const documents = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);
    const doc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      createdBy: user.id,
    });

    const version = await versions.create({
      documentId: doc.id,
      versionNumber: 1,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
      uploadedBy: user.id,
    });

    expect(version.sha256).toBe(SHA_A);
    expect(version.orgId).toBe(org.id);
    expect(typeof version.sizeBytes).toBe("number");
    expect(version.sizeBytes).toBe(1024);
  });

  it("findById() returns the mapped version, or null for an unknown id", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "findbyid");
    const documents = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);
    const doc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      createdBy: user.id,
    });
    const created = await versions.create({
      documentId: doc.id,
      versionNumber: 1,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
      uploadedBy: user.id,
    });

    const found = await versions.findById(created.id);
    expect(found?.sha256).toBe(SHA_A);

    const missing = await versions.findById(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing).toBeNull();
  });

  it("listByDocument() returns versions oldest-first by versionNumber, or an empty array for an unknown document", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "listbydoc");
    const documents = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);
    const doc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      createdBy: user.id,
    });

    // Seed v3, v1, v2 out of order.
    await versions.create({
      documentId: doc.id,
      versionNumber: 3,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 300,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v3`,
      uploadedBy: user.id,
    });
    await versions.create({
      documentId: doc.id,
      versionNumber: 1,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: SHA_B,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
      uploadedBy: user.id,
    });
    await versions.create({
      documentId: doc.id,
      versionNumber: 2,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 200,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v2`,
      uploadedBy: user.id,
    });

    const list = await versions.listByDocument(doc.id);
    expect(list.map((v) => v.versionNumber)).toEqual([1, 2, 3]);

    const empty = await versions.listByDocument(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(empty).toEqual([]);
  });

  it("latestVersionNumber() returns the max version number, or 0 when the document has no versions", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "latestver");
    const documents = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);
    const doc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      createdBy: user.id,
    });

    expect(await versions.latestVersionNumber(doc.id)).toBe(0);

    await versions.create({
      documentId: doc.id,
      versionNumber: 1,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
      uploadedBy: user.id,
    });
    await versions.create({
      documentId: doc.id,
      versionNumber: 2,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 200,
      sha256: SHA_B,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v2`,
      uploadedBy: user.id,
    });

    expect(await versions.latestVersionNumber(doc.id)).toBe(2);
  });

  it("scopes every read/list to the bound org — a foreign-org version is invisible", async () => {
    const { org: orgA } = await seedOrgAndUser({ orgs, users }, "isoa");
    const { org: orgB, user: userB } = await seedOrgAndUser(
      { orgs, users },
      "isob",
    );
    const documentsB = new DocumentRepo(db, orgB.id);
    const versionsA = new DocumentVersionRepo(db, orgA.id);
    const versionsB = new DocumentVersionRepo(db, orgB.id);

    const docB = await documentsB.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "b.pdf",
      createdBy: userB.id,
    });
    const versionB = await versionsB.create({
      documentId: docB.id,
      versionNumber: 1,
      originalFilename: "b.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: SHA_A,
      s3Key: `orgs/${orgB.id}/docs/${docB.id}/v1`,
      uploadedBy: userB.id,
    });

    expect(await versionsA.findById(versionB.id)).toBeNull();
    expect(await versionsA.listByDocument(docB.id)).toEqual([]);
  });

  it("create() rejects a sha256 that is not exactly 64 lowercase hex chars (Inspector T-004)", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "badsha");
    const doc = await new DocumentRepo(db, org.id).create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      createdBy: user.id,
    });
    const versions = new DocumentVersionRepo(db, org.id);
    const base = {
      documentId: doc.id,
      versionNumber: 1,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      s3Key: "k",
      uploadedBy: user.id,
    };
    await expect(
      versions.create({ ...base, sha256: "not-hex" }),
    ).rejects.toThrow();
    await expect(
      versions.create({ ...base, sha256: "AB".repeat(32) }), // uppercase rejected
    ).rejects.toThrow();
    await expect(
      versions.create({ ...base, sha256: "a".repeat(63) }), // wrong length
    ).rejects.toThrow();
  });
});
