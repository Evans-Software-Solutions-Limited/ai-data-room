// Integration test for the retention sweep (T-010) against real Postgres +
// `aws-sdk-client-mock` (S3). Frozen clock + seeded fixtures prove the DoD:
// expired data is reclaimed, in-window data is untouched, forensic rows are
// written (with a NULL system actor), and a second run is a no-op.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mockClient } from "aws-sdk-client-mock";
import { PutObjectTaggingCommand, S3Client } from "@aws-sdk/client-s3";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";
import { schema } from "@ai-data-room/db";

import { AuditRepo } from "../../../src/infrastructure/db/auditRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { scopedRepo } from "../../../src/infrastructure/db/scoped";
import { createS3DocumentStore } from "../../../src/infrastructure/s3/client";
import { runRetentionSweep } from "../../../src/application/room/retention";
import { seedOrgAndUser } from "../db/fixtures";

const BUCKET = "aidr-docs-test";
const SHA_A = "a".repeat(64);
// Frozen sweep clock. Cutoffs: soft-delete 30d, archive 90d, draft 24h.
const NOW = new Date("2026-07-17T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

const s3client = new S3Client({
  region: "eu-west-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const s3Mock = mockClient(s3client as never);

describe("Retention sweep (integration)", () => {
  let db: PostgresJsDatabase<typeof schema>;
  let orgs: OrgRepo;
  let users: UserRepo;
  let store: ReturnType<typeof createS3DocumentStore>;

  beforeAll(async () => {
    await applyMigrations();
    db = drizzle(getTestPool(), { schema });
    orgs = new OrgRepo(db);
    users = new UserRepo(db);
    store = createS3DocumentStore({
      client: s3client as never,
      bucket: BUCKET,
    });
  });

  beforeEach(async () => {
    await truncateAllTables();
    s3Mock.reset();
    s3Mock.on(PutObjectTaggingCommand as never).resolves({});
  });

  afterAll(async () => {
    await destroyTestPool();
    s3Mock.restore();
  });

  function deps() {
    return { db, orgs, store, auditRepo: new AuditRepo(db) };
  }

  /** Seed an active document with one version. Returns the doc id. */
  async function seedActiveDoc(
    orgId: string,
    userId: string,
    displayName: string,
    opportunityId: string | null = null,
  ): Promise<string> {
    const scoped = scopedRepo(orgId, db);
    const doc = await scoped.documents.create({
      folderKind: opportunityId ? "opportunity" : "canonical",
      canonicalFolder: opportunityId ? null : "02_Financials",
      opportunityId,
      displayName,
      createdBy: userId,
    });
    const version = await scoped.documentVersions.create({
      documentId: doc.id,
      versionNumber: 1,
      originalFilename: displayName,
      mimeType: "application/pdf",
      sizeBytes: 1024,
      sha256: SHA_A,
      s3Key: `orgs/${orgId}/documents/${doc.id}/v1`,
      s3VersionId: "s3-ver-1",
      uploadedBy: userId,
    });
    await scoped.documents.markActive(doc.id, version.id);
    return doc.id;
  }

  it("hard-deletes expired soft-deletes, leaves in-window ones, writes a NULL-actor forensic row", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "sd");
    const scoped = scopedRepo(org.id, db);
    const expired = await seedActiveDoc(org.id, user.id, "old.pdf");
    const fresh = await seedActiveDoc(org.id, user.id, "recent.pdf");
    // Stamp soft_deleted_at directly via the repo's `at` param.
    await scoped.documents.softDelete(expired, daysAgo(31));
    await scoped.documents.softDelete(fresh, daysAgo(10));

    const summary = await runRetentionSweep({ now: NOW }, deps());

    expect(summary.documentsHardDeleted).toBe(1);
    // Expired doc gone; its versions cascade-dropped; forensic row written.
    expect(
      await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, expired)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, expired)),
    ).toHaveLength(0);
    const deletions = await scoped.documentDeletions.listByDocument(expired);
    expect(deletions).toHaveLength(1);
    // The system sweep has no user actor — the forensic initiator is null.
    expect(deletions[0]?.softDeletedBy).toBeNull();
    // Fresh soft-delete untouched (still within its 30-day window).
    const [freshRow] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, fresh));
    expect(freshRow?.state).toBe("soft_deleted");

    // Version object tagged state=hard-deleted (not deleted).
    expect(s3Mock.commandCalls(PutObjectTaggingCommand as never)).toHaveLength(
      1,
    );
    // Audit: file_hard_deleted, null actor, system reason.
    const [audit] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "file_hard_deleted"));
    expect(audit?.actorUserId).toBeNull();
    expect(audit?.metadata).toMatchObject({
      actor: "system",
      reason: "retention_sweep",
    });
  });

  it("purges an expired archived subroom (docs + opportunity row), leaves an in-window one", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "arch");
    const scoped = scopedRepo(org.id, db);

    const expiredOpp = await scoped.opportunities.create({
      slug: "old-deal",
      name: "Old Deal",
      createdBy: user.id,
    });
    const freshOpp = await scoped.opportunities.create({
      slug: "new-deal",
      name: "New Deal",
      createdBy: user.id,
    });
    await seedActiveDoc(org.id, user.id, "d1.pdf", expiredOpp.id);
    await seedActiveDoc(org.id, user.id, "d2.pdf", expiredOpp.id);
    await seedActiveDoc(org.id, user.id, "keep.pdf", freshOpp.id);
    await scoped.opportunities.archive(expiredOpp.id, daysAgo(91));
    await scoped.opportunities.archive(freshOpp.id, daysAgo(10));

    const summary = await runRetentionSweep({ now: NOW }, deps());

    expect(summary.opportunitiesHardDeleted).toBe(1);
    expect(summary.documentsHardDeleted).toBe(2);
    // Expired opp + its docs gone.
    expect(await scoped.opportunities.findById(expiredOpp.id)).toBeNull();
    expect(
      await scoped.documents.listAllByOpportunity(expiredOpp.id),
    ).toHaveLength(0);
    // In-window opp + its doc retained.
    expect(await scoped.opportunities.findById(freshOpp.id)).not.toBeNull();
    expect(
      await scoped.documents.listAllByOpportunity(freshOpp.id),
    ).toHaveLength(1);
  });

  it("purges drafts older than 24h, leaves fresh drafts", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "draft");
    const scoped = scopedRepo(org.id, db);
    // Two draft documents (create() leaves state='draft', no version).
    const staleDraft = await scoped.documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      opportunityId: null,
      displayName: "stale.pdf",
      createdBy: user.id,
    });
    const freshDraft = await scoped.documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      opportunityId: null,
      displayName: "fresh.pdf",
      createdBy: user.id,
    });
    // created_at isn't settable via create(); backdate the stale one directly.
    await db
      .update(schema.documents)
      .set({ createdAt: hoursAgo(25) })
      .where(eq(schema.documents.id, staleDraft.id));
    await db
      .update(schema.documents)
      .set({ createdAt: hoursAgo(1) })
      .where(eq(schema.documents.id, freshDraft.id));

    const summary = await runRetentionSweep({ now: NOW }, deps());

    expect(summary.draftsPurged).toBe(1);
    expect(
      await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, staleDraft.id)),
    ).toHaveLength(0);
    expect(await scoped.documents.findById(freshDraft.id)).not.toBeNull();
    // A draft has no version/S3 object to tag.
    expect(s3Mock.commandCalls(PutObjectTaggingCommand as never)).toHaveLength(
      0,
    );
  });

  it("purgeDraft refuses to delete a document that was completed (state guard)", async () => {
    // The janitor's TOCTOU guard: a draft that becomes active between the
    // eligibility read and the delete must NOT be destroyed (it would lose
    // a live document with no forensic row / S3 tag).
    const { org, user } = await seedOrgAndUser({ orgs, users }, "guard");
    const scoped = scopedRepo(org.id, db);
    const activeDoc = await seedActiveDoc(org.id, user.id, "live.pdf");

    const purged = await scoped.documents.purgeDraft(activeDoc);

    expect(purged).toBeNull();
    expect(await scoped.documents.findById(activeDoc)).not.toBeNull();
  });

  it("is idempotent: a second run on unchanged data is an all-zero no-op", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "idem");
    const scoped = scopedRepo(org.id, db);
    const expired = await seedActiveDoc(org.id, user.id, "old.pdf");
    await scoped.documents.softDelete(expired, daysAgo(31));

    const first = await runRetentionSweep({ now: NOW }, deps());
    expect(first.documentsHardDeleted).toBe(1);

    const second = await runRetentionSweep({ now: NOW }, deps());
    expect(second).toEqual({
      orgsSwept: 1,
      orgsFailed: 0,
      documentsHardDeleted: 0,
      opportunitiesHardDeleted: 0,
      draftsPurged: 0,
    });
    // Still exactly one forensic row — no duplicate.
    expect(await scoped.documentDeletions.listByDocument(expired)).toHaveLength(
      1,
    );
  });

  it("sweeps every org, attributing each forensic row to its own org", async () => {
    const a = await seedOrgAndUser({ orgs, users }, "orga");
    const b = await seedOrgAndUser({ orgs, users }, "orgb");
    const docA = await seedActiveDoc(a.org.id, a.user.id, "a.pdf");
    const docB = await seedActiveDoc(b.org.id, b.user.id, "b.pdf");
    await scopedRepo(a.org.id, db).documents.softDelete(docA, daysAgo(31));
    await scopedRepo(b.org.id, db).documents.softDelete(docB, daysAgo(31));

    const summary = await runRetentionSweep({ now: NOW }, deps());

    expect(summary.orgsSwept).toBe(2);
    expect(summary.documentsHardDeleted).toBe(2);
    const [delA] = await scopedRepo(
      a.org.id,
      db,
    ).documentDeletions.listByDocument(docA);
    const [delB] = await scopedRepo(
      b.org.id,
      db,
    ).documentDeletions.listByDocument(docB);
    expect(delA?.orgId).toBe(a.org.id);
    expect(delB?.orgId).toBe(b.org.id);
  });
});
