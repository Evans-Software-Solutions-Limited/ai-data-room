// Integration test for the document deletion lifecycle (T-009) against
// real Postgres (repos) + `aws-sdk-client-mock` (S3). Proves the three
// transitions end-to-end: soft-delete hides a document from listings and
// starts the clock; restore reverses it within the 30-day window and is
// refused after it; hard-delete removes the document + cascades its
// versions, writes a filename-free forensic row, and tags each version's
// S3 object `state=hard-deleted`.
//
// A REAL `S3Client` (dummy creds) wrapped by `mockClient(instance)`
// intercepts `.send` (PutObjectTagging), mirroring the upload/listing
// integration tests.

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
import {
  hardDeleteDocument,
  restoreDocument,
  softDeleteDocument,
  SOFT_DELETE_RETENTION_DAYS,
} from "../../../src/application/room/deletion";
import { listFolderContents } from "../../../src/application/room/listing";
import { seedOrgAndUser } from "../db/fixtures";

const BUCKET = "aidr-docs-test";
const AUDIT_CTX = { sourceIp: "127.0.0.1", userAgent: "vitest" } as const;
const SHA_A = "a".repeat(64);
const CANONICAL = { kind: "canonical", folder: "02_Financials" } as const;
const RETENTION_MS = SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const s3client = new S3Client({
  region: "eu-west-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const s3Mock = mockClient(s3client as never);

describe("Document deletion lifecycle (integration)", () => {
  let db: PostgresJsDatabase<typeof schema>;
  let orgs: OrgRepo;
  let users: UserRepo;

  beforeAll(async () => {
    await applyMigrations();
    db = drizzle(getTestPool(), { schema });
    orgs = new OrgRepo(db);
    users = new UserRepo(db);
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

  function makeDeps(orgId: string) {
    const scoped = scopedRepo(orgId, db);
    const store = createS3DocumentStore({
      client: s3client as never,
      bucket: BUCKET,
    });
    const auditRepo = new AuditRepo(db);
    return {
      scoped,
      auditRepo,
      store,
      softDeps: { documents: scoped.documents, auditRepo },
      restoreDeps: { documents: scoped.documents, auditRepo },
      hardDeps: {
        db,
        documents: scoped.documents,
        documentVersions: scoped.documentVersions,
        documentDeletions: scoped.documentDeletions,
        store,
        auditRepo,
      },
      listingDeps: {
        documents: scoped.documents,
        opportunities: scoped.opportunities,
        auditRepo,
      },
    };
  }

  /** Seed one active document with `versionCount` versions via the real
   *  repos (mirrors the upload pipeline's post-conditions). */
  async function seedActiveDocument(
    deps: ReturnType<typeof makeDeps>,
    orgId: string,
    userId: string,
    displayName: string,
    versionCount = 1,
  ) {
    const doc = await deps.scoped.documents.create({
      folderKind: "canonical",
      canonicalFolder: CANONICAL.folder,
      opportunityId: null,
      displayName,
      createdBy: userId,
    });
    let currentVersionId = "";
    for (let n = 1; n <= versionCount; n++) {
      const version = await deps.scoped.documentVersions.create({
        documentId: doc.id,
        versionNumber: n,
        originalFilename: displayName,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        sha256: SHA_A,
        s3Key: `orgs/${orgId}/documents/${doc.id}/v${n}`,
        s3VersionId: `s3-ver-${n}`,
        uploadedBy: userId,
      });
      currentVersionId = version.id;
      if (n === 1) {
        await deps.scoped.documents.markActive(doc.id, version.id);
      } else {
        await deps.scoped.documents.setCurrentVersion(doc.id, version.id);
      }
    }
    return { docId: doc.id, currentVersionId };
  }

  async function listCanonical(
    deps: ReturnType<typeof makeDeps>,
    actorUserId: string,
  ) {
    const listing = await listFolderContents(
      { target: CANONICAL, actorUserId, audit: AUDIT_CTX },
      deps.listingDeps,
    );
    return listing.documents;
  }

  it("soft-delete hides the document from listings and stamps soft_deleted_at", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "soft");
    const deps = makeDeps(org.id);
    const { docId } = await seedActiveDocument(deps, org.id, user.id, "F.pdf");

    expect(await listCanonical(deps, user.id)).toHaveLength(1);

    await softDeleteDocument(
      { documentId: docId, actorUserId: user.id, audit: AUDIT_CTX },
      deps.softDeps,
    );

    // Hidden from the folder listing (FR17).
    expect(await listCanonical(deps, user.id)).toHaveLength(0);

    const [row] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, docId));
    expect(row?.state).toBe("soft_deleted");
    expect(row?.softDeletedAt).toBeInstanceOf(Date);

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "file_soft_deleted"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.outcome).toBe("success");
    expect(audits[0]?.orgId).toBe(org.id);
  });

  it("restore within the window returns the document to the listing", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "restorein");
    const deps = makeDeps(org.id);
    const { docId } = await seedActiveDocument(deps, org.id, user.id, "F.pdf");

    await softDeleteDocument(
      { documentId: docId, actorUserId: user.id, audit: AUDIT_CTX },
      deps.softDeps,
    );
    await restoreDocument(
      { documentId: docId, actorUserId: user.id, audit: AUDIT_CTX },
      deps.restoreDeps,
    );

    expect(await listCanonical(deps, user.id)).toHaveLength(1);
    const [row] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, docId));
    expect(row?.state).toBe("active");
    expect(row?.softDeletedAt).toBeNull();

    const restored = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "file_restored"));
    expect(restored).toHaveLength(1);
    expect(restored[0]?.outcome).toBe("success");
  });

  it("restore after the 30-day window is refused; the document stays soft-deleted", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "restoreout");
    const deps = makeDeps(org.id);
    const { docId } = await seedActiveDocument(deps, org.id, user.id, "F.pdf");

    // Stamp soft_deleted_at at a fixed past instant, then attempt restore
    // just past the window — deterministic, no wall-clock dependence.
    const deletedAt = new Date("2026-01-01T00:00:00Z");
    await softDeleteDocument(
      {
        documentId: docId,
        actorUserId: user.id,
        audit: AUDIT_CTX,
        now: deletedAt,
      },
      deps.softDeps,
    );

    await expect(
      restoreDocument(
        {
          documentId: docId,
          actorUserId: user.id,
          audit: AUDIT_CTX,
          now: new Date(deletedAt.getTime() + RETENTION_MS + 1),
        },
        deps.restoreDeps,
      ),
    ).rejects.toMatchObject({ reason: "retention_expired" });

    const [row] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, docId));
    expect(row?.state).toBe("soft_deleted");

    const failed = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "file_restored"));
    expect(failed).toHaveLength(1);
    expect(failed[0]?.outcome).toBe("failure");
  });

  it("hard-delete removes the document + cascades versions, writes a forensic row, tags each object", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "hard");
    const deps = makeDeps(org.id);
    const { docId } = await seedActiveDocument(
      deps,
      org.id,
      user.id,
      "F.pdf",
      2,
    );

    await hardDeleteDocument(
      { documentId: docId, actorUserId: user.id, audit: AUDIT_CTX },
      deps.hardDeps,
    );

    // Document row gone.
    const docs = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, docId));
    expect(docs).toHaveLength(0);

    // Versions cascade-deleted.
    const versions = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, docId));
    expect(versions).toHaveLength(0);

    // Forensic record written (outlives the document — no FK), no filename.
    const deletions = await deps.scoped.documentDeletions.listByDocument(docId);
    expect(deletions).toHaveLength(1);
    expect(deletions[0]?.softDeletedBy).toBe(user.id);
    expect(deletions[0]).not.toHaveProperty("displayName");

    // Both version objects tagged state=hard-deleted.
    const tagCalls = s3Mock.commandCalls(PutObjectTaggingCommand as never);
    expect(tagCalls).toHaveLength(2);
    const taggedKeys = tagCalls.map(
      (c) => (c.args[0].input as { Key: string }).Key,
    );
    expect(taggedKeys).toEqual(
      expect.arrayContaining([
        `orgs/${org.id}/documents/${docId}/v1`,
        `orgs/${org.id}/documents/${docId}/v2`,
      ]),
    );

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "file_hard_deleted"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.outcome).toBe("success");
  });

  it("hard-delete is org-scoped: org B cannot hard-delete org A's document", async () => {
    const a = await seedOrgAndUser({ orgs, users }, "hda");
    const b = await seedOrgAndUser({ orgs, users }, "hdb");
    const depsA = makeDeps(a.org.id);
    const depsB = makeDeps(b.org.id);
    const { docId } = await seedActiveDocument(
      depsA,
      a.org.id,
      a.user.id,
      "A.pdf",
    );

    // Org B's scoped hard-delete can't see A's document → not_found.
    await expect(
      hardDeleteDocument(
        { documentId: docId, actorUserId: b.user.id, audit: AUDIT_CTX },
        depsB.hardDeps,
      ),
    ).rejects.toMatchObject({ reason: "not_found" });

    // A's document is untouched.
    const docs = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, docId));
    expect(docs).toHaveLength(1);
    expect(s3Mock.commandCalls(PutObjectTaggingCommand as never)).toHaveLength(
      0,
    );
  });
});
