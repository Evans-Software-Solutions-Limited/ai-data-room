// Integration test for the room/folder listing + document-download
// application flows (T-008) against real Postgres (repos) +
// `aws-sdk-client-mock` (S3). Mirrors `upload.integration.test.ts`'s
// pattern: a REAL `S3Client` instance (dummy creds) wrapped by
// `mockClient(instance)` so `getSignedUrl` (the presign path) signs
// locally against the real config while `.send` is intercepted.

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mockClient } from "aws-sdk-client-mock";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
  DownloadError,
  getDocument,
  listVersions,
} from "../../../src/application/room/download";
import { listFolderContents } from "../../../src/application/room/listing";
import { seedOrgAndUser } from "../db/fixtures";

const BUCKET = "aidr-docs-test";
const AUDIT_CTX = { sourceIp: "127.0.0.1", userAgent: "vitest" } as const;
const SHA_A = "a".repeat(64);

const s3client = new S3Client({
  region: "eu-west-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const s3Mock = mockClient(s3client as never);

describe("Listing + download application flow (integration)", () => {
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
    // The only S3 call these flows make is GetObject (via
    // presignDownloadUrl's getSignedUrl, which signs locally and never
    // hits `.send`) — nothing here actually needs a mocked response, but
    // reset() keeps each test's call history isolated.
    s3Mock.on(GetObjectCommand as never).resolves({});
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
      listingDeps: {
        documents: scoped.documents,
        opportunities: scoped.opportunities,
        auditRepo,
      },
      downloadDeps: {
        documents: scoped.documents,
        documentVersions: scoped.documentVersions,
        opportunities: scoped.opportunities,
        store,
        auditRepo,
      },
    };
  }

  /** Seed one active document with a single version, via the real repos
   *  (mirrors the upload pipeline's post-conditions), returning both rows. */
  async function seedActiveDocument(
    deps: ReturnType<typeof makeDeps>,
    orgId: string,
    userId: string,
    displayName: string,
    target:
      | { kind: "canonical"; folder: "02_Financials" }
      | { kind: "opportunity"; opportunityId: string },
  ) {
    const doc = await deps.scoped.documents.create({
      folderKind: target.kind,
      canonicalFolder: target.kind === "canonical" ? target.folder : null,
      opportunityId:
        target.kind === "opportunity" ? target.opportunityId : null,
      displayName,
      createdBy: userId,
    });
    const version = await deps.scoped.documentVersions.create({
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
    const activated = await deps.scoped.documents.markActive(
      doc.id,
      version.id,
    );
    return { doc: activated!, version };
  }

  it("listFolderContents (canonical) returns the doc as a DocumentDTO with the current version, no s3Key", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "listcanon");
    const deps = makeDeps(org.id);
    const { version } = await seedActiveDocument(
      deps,
      org.id,
      user.id,
      "Term Sheet.pdf",
      { kind: "canonical", folder: "02_Financials" },
    );

    const listing = await listFolderContents(
      {
        target: { kind: "canonical", folder: "02_Financials" },
        actorUserId: user.id,
        audit: AUDIT_CTX,
      },
      deps.listingDeps,
    );

    expect(listing.documents).toHaveLength(1);
    const dto = listing.documents[0]!;
    expect(dto.folder).toEqual({ kind: "canonical", folder: "02_Financials" });
    expect(dto.currentVersion.id).toBe(version.id);
    expect(dto.currentVersion).not.toHaveProperty("s3Key");

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "folder_listed"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.outcome).toBe("success");
    expect(audits[0]?.orgId).toBe(org.id);
  });

  it("getDocument returns a presigned URL and writes a file_downloaded audit", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "getdoc");
    const deps = makeDeps(org.id);
    const { doc, version } = await seedActiveDocument(
      deps,
      org.id,
      user.id,
      "report.pdf",
      { kind: "canonical", folder: "02_Financials" },
    );

    const result = await getDocument(
      { documentId: doc.id, actorUserId: user.id, audit: AUDIT_CTX },
      deps.downloadDeps,
    );

    expect(result.downloadUrl).toContain("https://");
    expect(result.document.currentVersion.id).toBe(version.id);

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "file_downloaded"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.outcome).toBe("success");
    expect(audits[0]?.orgId).toBe(org.id);
  });

  it("getDocument throws not_found for a soft-deleted document", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "getdocdel");
    const deps = makeDeps(org.id);
    const { doc } = await seedActiveDocument(
      deps,
      org.id,
      user.id,
      "gone.pdf",
      { kind: "canonical", folder: "02_Financials" },
    );
    await deps.scoped.documents.softDelete(doc.id);

    await expect(
      getDocument(
        { documentId: doc.id, actorUserId: user.id, audit: AUDIT_CTX },
        deps.downloadDeps,
      ),
    ).rejects.toThrow(DownloadError);
  });

  it("listVersions returns the version history", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "listver");
    const deps = makeDeps(org.id);
    const { doc } = await seedActiveDocument(
      deps,
      org.id,
      user.id,
      "history.pdf",
      { kind: "canonical", folder: "02_Financials" },
    );
    // A second upload adds version 2.
    const v2 = await deps.scoped.documentVersions.create({
      documentId: doc.id,
      versionNumber: 2,
      originalFilename: "history.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/documents/${doc.id}/v2`,
      s3VersionId: "s3-ver-2",
      uploadedBy: user.id,
    });
    await deps.scoped.documents.setCurrentVersion(doc.id, v2.id);

    const history = await listVersions(
      { documentId: doc.id },
      deps.downloadDeps,
    );

    expect(history.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(history[0]).not.toHaveProperty("s3Key");
  });

  it("listFolderContents (opportunity) hides archived subrooms (FR6)", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "archopp");
    const deps = makeDeps(org.id);
    const opp = await deps.scoped.opportunities.create({
      slug: "Vendor_A",
      name: "Vendor A",
      createdBy: user.id,
    });
    await seedActiveDocument(deps, org.id, user.id, "nda.pdf", {
      kind: "opportunity",
      opportunityId: opp.id,
    });
    await deps.scoped.opportunities.archive(opp.id);

    await expect(
      listFolderContents(
        {
          target: { kind: "opportunity", opportunityId: opp.id },
          actorUserId: user.id,
          audit: AUDIT_CTX,
        },
        deps.listingDeps,
      ),
    ).rejects.toThrow(/folder_not_found/);
  });

  it("cross-tenant: listFolderContents under org A never returns org B's docs in the same folder", async () => {
    const a = await seedOrgAndUser({ orgs, users }, "isoa");
    const b = await seedOrgAndUser({ orgs, users }, "isob");
    const depsA = makeDeps(a.org.id);
    const depsB = makeDeps(b.org.id);

    await seedActiveDocument(depsA, a.org.id, a.user.id, "shared.pdf", {
      kind: "canonical",
      folder: "02_Financials",
    });
    await seedActiveDocument(depsB, b.org.id, b.user.id, "shared.pdf", {
      kind: "canonical",
      folder: "02_Financials",
    });

    const listingA = await listFolderContents(
      {
        target: { kind: "canonical", folder: "02_Financials" },
        actorUserId: a.user.id,
        audit: AUDIT_CTX,
      },
      depsA.listingDeps,
    );
    const listingB = await listFolderContents(
      {
        target: { kind: "canonical", folder: "02_Financials" },
        actorUserId: b.user.id,
        audit: AUDIT_CTX,
      },
      depsB.listingDeps,
    );

    expect(listingA.documents).toHaveLength(1);
    expect(listingB.documents).toHaveLength(1);
    expect(listingA.documents[0]?.id).not.toBe(listingB.documents[0]?.id);
  });

  // ── NFR4: folder listing stays fast at scale ──────────────────────────

  it("NFR4: listFolderContents on 500 active docs in one folder completes in < 500ms (median of 3)", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "perf500");
    const deps = makeDeps(org.id);
    const DOC_COUNT = 500;

    // Batch-insert 500 documents + their versions in two round-trips,
    // then flip them all active in a third — far cheaper than 500
    // sequential app-layer upload calls, and this seeding isn't the
    // timed portion of the test anyway.
    const docIds = Array.from({ length: DOC_COUNT }, () => randomUUID());
    const versionIds = docIds.map(() => randomUUID());

    await db.insert(schema.documents).values(
      docIds.map((id, i) => ({
        id,
        orgId: org.id,
        folderKind: "canonical" as const,
        canonicalFolder: "02_Financials",
        displayName: `Document ${String(i).padStart(4, "0")}.pdf`,
        state: "draft" as const,
        createdBy: user.id,
      })),
    );
    await db.insert(schema.documentVersions).values(
      docIds.map((docId, i) => ({
        id: versionIds[i]!,
        documentId: docId,
        orgId: org.id,
        versionNumber: 1,
        originalFilename: `Document ${i}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        sha256: Buffer.from(SHA_A, "hex"),
        s3Key: `orgs/${org.id}/documents/${docId}/${versionIds[i]}`,
        s3VersionId: "s3-ver-1",
        uploadedBy: user.id,
      })),
    );
    // One round-trip: pair each document with its version via a VALUES
    // list, flip state to active and set current_version_id together.
    const pairs = docIds.map(
      (docId, i) => sql`(${docId}::uuid, ${versionIds[i]}::uuid)`,
    );
    await db.execute(sql`
        UPDATE ${schema.documents} AS d
        SET current_version_id = v.version_id, state = 'active'
        FROM (VALUES ${sql.join(pairs, sql`, `)}) AS v(doc_id, version_id)
        WHERE d.id = v.doc_id
      `);

    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const listing = await listFolderContents(
        {
          target: { kind: "canonical", folder: "02_Financials" },
          actorUserId: user.id,
          audit: AUDIT_CTX,
        },
        deps.listingDeps,
      );
      runs.push(performance.now() - start);
      expect(listing.documents).toHaveLength(DOC_COUNT);
    }

    runs.sort((a, b) => a - b);
    const median = runs[1]!;
    expect(median).toBeLessThan(500);
  }, 30_000);
});
