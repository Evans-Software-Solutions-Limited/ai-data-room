// Integration test for the upload application flow (T-007) against real
// Postgres (repos) + `aws-sdk-client-mock` (S3). Proves the end-to-end
// initiate→complete pipeline writes the right rows, that sha256 is the
// real digest of the object bytes, and the FR13 collision path adds a
// version rather than a second document.
//
// The S3 client is a REAL `S3Client` instance (dummy creds) wrapped by
// `mockClient(instance)`: `getSignedUrl` (part presigning) signs locally
// against the real config, while `.send` (create/complete/head/get) is
// intercepted by the mock — so one client serves both paths.

import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mockClient } from "aws-sdk-client-mock";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

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
  completeUpload,
  initiateUpload,
} from "../../../src/application/room/upload";
import { seedOrgAndUser } from "../db/fixtures";

const BUCKET = "aidr-docs-test";
const BODY = Buffer.from("hello ai-data-room document contents");
const EXPECTED_SHA = createHash("sha256").update(BODY).digest("hex");
const AUDIT_CTX = { sourceIp: "127.0.0.1", userAgent: "vitest" } as const;

const s3client = new S3Client({
  region: "eu-west-2",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});
const s3Mock = mockClient(s3client as never);

describe("Upload application flow (integration)", () => {
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
    s3Mock
      .on(CreateMultipartUploadCommand as never)
      .resolves({ UploadId: "upload-xyz" } as never);
    s3Mock
      .on(CompleteMultipartUploadCommand as never)
      .resolves({ VersionId: "s3-ver-1" } as never);
    s3Mock.on(HeadObjectCommand as never).resolves({
      ContentLength: BODY.length,
      ContentType: "application/pdf",
    } as never);
    // callsFake so every computeSha256 call gets a FRESH stream (a
    // resolved Readable would be consumed after the first read).
    s3Mock
      .on(GetObjectCommand as never)
      .callsFake(() => ({ Body: Readable.from([BODY]) }));
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
    return {
      scoped,
      initiateDeps: {
        documents: scoped.documents,
        opportunities: scoped.opportunities,
        store,
      },
      completeDeps: {
        db,
        documents: scoped.documents,
        documentVersions: scoped.documentVersions,
        store,
        auditRepo: new AuditRepo(db),
      },
    };
  }

  async function upload(
    orgId: string,
    userId: string,
    filename: string,
    deps: ReturnType<typeof makeDeps>,
  ) {
    const init = await initiateUpload(
      {
        target: { kind: "canonical", folder: "02_Financials" },
        filename,
        mimeType: "application/pdf",
        sizeBytes: BODY.length,
        actorUserId: userId,
      },
      deps.initiateDeps,
    );
    return completeUpload(
      {
        uploadId: init.uploadId,
        documentId: init.documentId,
        versionId: init.versionId,
        parts: [{ partNumber: 1, eTag: "etag-1" }],
        actorUserId: userId,
        audit: AUDIT_CTX,
      },
      deps.completeDeps,
    ).then((res) => ({ init, res }));
  }

  it("initiate→complete creates an active document, version 1, and a file_uploaded audit", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "upload");
    const deps = makeDeps(org.id);

    const { init, res } = await upload(org.id, user.id, "Term Sheet.pdf", deps);
    expect(res.versionNumber).toBe(1);

    const [doc] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, init.documentId));
    expect(doc?.state).toBe("active");
    expect(doc?.currentVersionId).toBe(init.versionId);

    const version = await deps.scoped.documentVersions.findById(init.versionId);
    expect(version?.versionNumber).toBe(1);
    expect(version?.originalFilename).toBe("Term Sheet.pdf");
    expect(version?.sizeBytes).toBe(BODY.length);
    expect(version?.s3Key).toBe(init.key);
    // sha256 is the REAL digest of the (mocked) object bytes, round-tripped
    // through the bytea⇄hex mapping in the version repo.
    expect(version?.sha256).toBe(EXPECTED_SHA);

    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "file_uploaded"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.outcome).toBe("success");
    expect(audits[0]?.orgId).toBe(org.id);
  });

  it("collision detection is org-scoped: org B's same-named upload is a new document, not org A's", async () => {
    // Guards `findActiveByName`'s tenant scoping: an unscoped variant would
    // match org A's "shared.pdf" and (wrongly) add a version to A's doc when
    // org B uploads the same filename.
    const a = await seedOrgAndUser({ orgs, users }, "orga");
    const b = await seedOrgAndUser({ orgs, users }, "orgb");
    const depsA = makeDeps(a.org.id);
    const depsB = makeDeps(b.org.id);

    const uploadA = await upload(a.org.id, a.user.id, "shared.pdf", depsA);
    const uploadB = await upload(b.org.id, b.user.id, "shared.pdf", depsB);

    // Different documents in different orgs despite the identical filename.
    expect(uploadB.init.documentId).not.toBe(uploadA.init.documentId);
    expect(uploadB.res.versionNumber).toBe(1); // NOT 2 — didn't see A's doc
    const bDocs =
      await depsB.scoped.documents.listByCanonicalFolder("02_Financials");
    expect(bDocs).toHaveLength(1);
    expect(bDocs[0]?.id).toBe(uploadB.init.documentId);
  });

  it("FR13: re-uploading the same filename creates version 2, not a second document", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "collide");
    const deps = makeDeps(org.id);

    const first = await upload(org.id, user.id, "report.pdf", deps);
    const second = await upload(org.id, user.id, "report.pdf", deps);

    // Same logical document, two versions.
    expect(second.init.documentId).toBe(first.init.documentId);
    expect(first.res.versionNumber).toBe(1);
    expect(second.res.versionNumber).toBe(2);

    const docsInFolder =
      await deps.scoped.documents.listByCanonicalFolder("02_Financials");
    expect(docsInFolder).toHaveLength(1);

    const history = await deps.scoped.documentVersions.listByDocument(
      first.init.documentId,
    );
    expect(history.map((v) => v.versionNumber)).toEqual([1, 2]);

    const withCurrent = await deps.scoped.documents.getWithCurrentVersion(
      first.init.documentId,
    );
    expect(withCurrent?.currentVersion?.versionNumber).toBe(2);
  });
});
