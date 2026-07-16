// Integration tests for `DocumentRepo`.
//
// room-and-folders (slice 2) / T-004: `DocumentRepo` is a `ScopedRepo`
// subclass — the org is bound at construction, so each test seeds the
// org(s)/opportunity it needs and constructs its own repo instance(s)
// afterwards.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";
import { schema } from "@ai-data-room/db";

import { DocumentRepo } from "../../../src/infrastructure/db/documentRepo";
import { DocumentVersionRepo } from "../../../src/infrastructure/db/documentVersionRepo";
import { OpportunityRepo } from "../../../src/infrastructure/db/opportunityRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

const SHA_A = "a".repeat(64);

describe("DocumentRepo (integration)", () => {
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

  it("create() inserts a canonical-folder document, stamping the bound org and defaulting to draft", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "createcanon");
    const documents = new DocumentRepo(db, org.id);

    const doc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "budget.pdf",
      createdBy: user.id,
    });

    expect(doc.folderKind).toBe("canonical");
    expect(doc.canonicalFolder).toBe("02_Financials");
    expect(doc.opportunityId).toBeNull();
    expect(doc.state).toBe("draft");
    expect(doc.orgId).toBe(org.id);
  });

  it("create() inserts an opportunity-folder document", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "createopp");
    const opportunities = new OpportunityRepo(db, org.id);
    const documents = new DocumentRepo(db, org.id);
    const opp = await opportunities.create({
      slug: "Vendor_A",
      name: "Vendor A",
      createdBy: user.id,
    });

    const doc = await documents.create({
      folderKind: "opportunity",
      opportunityId: opp.id,
      displayName: "nda.pdf",
      createdBy: user.id,
    });

    expect(doc.folderKind).toBe("opportunity");
    expect(doc.opportunityId).toBe(opp.id);
    expect(doc.canonicalFolder).toBeNull();
    expect(doc.state).toBe("draft");
    expect(doc.orgId).toBe(org.id);
  });

  it("findById() returns the row, or null for an unknown id", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "findbyid");
    const documents = new DocumentRepo(db, org.id);
    const doc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      createdBy: user.id,
    });

    const found = await documents.findById(doc.id);
    expect(found?.id).toBe(doc.id);

    const missing = await documents.findById(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing).toBeNull();
  });

  it("getWithCurrentVersion() returns a null currentVersion for a draft, the resolved version once active, and null for an unknown id", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "getwithver");
    const documents = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);
    const doc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      createdBy: user.id,
    });

    const draftResult = await documents.getWithCurrentVersion(doc.id);
    expect(draftResult?.document.id).toBe(doc.id);
    expect(draftResult?.currentVersion).toBeNull();

    const version = await versions.create({
      documentId: doc.id,
      versionNumber: 1,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
      uploadedBy: user.id,
    });
    await documents.markActive(doc.id, version.id);

    const activeResult = await documents.getWithCurrentVersion(doc.id);
    expect(activeResult?.document.state).toBe("active");
    expect(activeResult?.document.currentVersionId).toBe(version.id);
    expect(activeResult?.currentVersion?.sha256).toBe(SHA_A);

    const missing = await documents.getWithCurrentVersion(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing).toBeNull();
  });

  it("listByCanonicalFolder() returns only active docs in that folder, ordered by displayName", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "listcanon");
    const documents = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);

    async function seedActiveDoc(
      displayName: string,
      folder: "02_Financials" | "03_Commercial",
    ) {
      const doc = await documents.create({
        folderKind: "canonical",
        canonicalFolder: folder,
        displayName,
        createdBy: user.id,
      });
      const version = await versions.create({
        documentId: doc.id,
        versionNumber: 1,
        originalFilename: displayName,
        mimeType: "application/pdf",
        sizeBytes: 100,
        sha256: SHA_A,
        s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
        uploadedBy: user.id,
      });
      return documents.markActive(doc.id, version.id);
    }

    await seedActiveDoc("beta.pdf", "02_Financials");
    await seedActiveDoc("alpha.pdf", "02_Financials");
    // Draft — excluded.
    await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "draft.pdf",
      createdBy: user.id,
    });
    // Soft-deleted — excluded.
    const deletedDoc = await seedActiveDoc("deleted.pdf", "02_Financials");
    await documents.softDelete(deletedDoc!.id);
    // Different canonical folder — excluded.
    await seedActiveDoc("other-folder.pdf", "03_Commercial");

    const listing = await documents.listByCanonicalFolder("02_Financials");
    expect(listing.map((d) => d.displayName)).toEqual([
      "alpha.pdf",
      "beta.pdf",
    ]);
  });

  it("listByOpportunity() returns only active docs in that opportunity, ordered by displayName", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "listopp");
    const opportunities = new OpportunityRepo(db, org.id);
    const documents = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);
    const opp = await opportunities.create({
      slug: "Vendor_A",
      name: "Vendor A",
      createdBy: user.id,
    });
    const otherOpp = await opportunities.create({
      slug: "Vendor_B",
      name: "Vendor B",
      createdBy: user.id,
    });

    async function seedActiveOppDoc(
      displayName: string,
      opportunityId: string,
    ) {
      const doc = await documents.create({
        folderKind: "opportunity",
        opportunityId,
        displayName,
        createdBy: user.id,
      });
      const version = await versions.create({
        documentId: doc.id,
        versionNumber: 1,
        originalFilename: displayName,
        mimeType: "application/pdf",
        sizeBytes: 100,
        sha256: SHA_A,
        s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
        uploadedBy: user.id,
      });
      return documents.markActive(doc.id, version.id);
    }

    await seedActiveOppDoc("zeta.pdf", opp.id);
    await seedActiveOppDoc("delta.pdf", opp.id);
    // Draft — excluded.
    await documents.create({
      folderKind: "opportunity",
      opportunityId: opp.id,
      displayName: "draft.pdf",
      createdBy: user.id,
    });
    // Different opportunity — excluded.
    await seedActiveOppDoc("other-opp.pdf", otherOpp.id);
    // Canonical folder — excluded.
    const canonDoc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "canon.pdf",
      createdBy: user.id,
    });
    const canonVersion = await versions.create({
      documentId: canonDoc.id,
      versionNumber: 1,
      originalFilename: "canon.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${canonDoc.id}/v1`,
      uploadedBy: user.id,
    });
    await documents.markActive(canonDoc.id, canonVersion.id);

    const listing = await documents.listByOpportunity(opp.id);
    expect(listing.map((d) => d.displayName)).toEqual([
      "delta.pdf",
      "zeta.pdf",
    ]);
  });

  it("markActive() flips draft to active and sets currentVersionId; a second call and an unknown id return null", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "markactive");
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
      sizeBytes: 100,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
      uploadedBy: user.id,
    });

    const activated = await documents.markActive(doc.id, version.id);
    expect(activated?.state).toBe("active");
    expect(activated?.currentVersionId).toBe(version.id);

    const secondCall = await documents.markActive(doc.id, version.id);
    expect(secondCall).toBeNull();

    const missing = await documents.markActive(
      "00000000-0000-4000-8000-000000000000",
      version.id,
    );
    expect(missing).toBeNull();
  });

  it("setCurrentVersion() updates currentVersionId on an active doc, and returns null when the doc is not active", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "setcurver");
    const documents = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);
    const doc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      createdBy: user.id,
    });
    const v1 = await versions.create({
      documentId: doc.id,
      versionNumber: 1,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
      uploadedBy: user.id,
    });

    // Still draft — setCurrentVersion should refuse.
    const onDraft = await documents.setCurrentVersion(doc.id, v1.id);
    expect(onDraft).toBeNull();

    await documents.markActive(doc.id, v1.id);
    const v2 = await versions.create({
      documentId: doc.id,
      versionNumber: 2,
      originalFilename: "x.pdf",
      mimeType: "application/pdf",
      sizeBytes: 200,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v2`,
      uploadedBy: user.id,
    });
    const updated = await documents.setCurrentVersion(doc.id, v2.id);
    expect(updated?.currentVersionId).toBe(v2.id);
  });

  it("softDelete() moves active to soft_deleted; a second call and an unknown id return null", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "softdelete");
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
      sizeBytes: 100,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
      uploadedBy: user.id,
    });
    await documents.markActive(doc.id, version.id);

    const deleted = await documents.softDelete(doc.id);
    expect(deleted?.state).toBe("soft_deleted");
    expect(deleted?.softDeletedAt).not.toBeNull();

    const secondCall = await documents.softDelete(doc.id);
    expect(secondCall).toBeNull();

    const missing = await documents.softDelete(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing).toBeNull();
  });

  it("restore() moves soft_deleted back to active and nulls softDeletedAt; returns null when the doc is not soft-deleted", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "restore");
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
      sizeBytes: 100,
      sha256: SHA_A,
      s3Key: `orgs/${org.id}/docs/${doc.id}/v1`,
      uploadedBy: user.id,
    });
    await documents.markActive(doc.id, version.id);

    // Still active — restore should refuse.
    const onActive = await documents.restore(doc.id);
    expect(onActive).toBeNull();

    await documents.softDelete(doc.id);
    const restored = await documents.restore(doc.id);
    expect(restored?.state).toBe("active");
    expect(restored?.softDeletedAt).toBeNull();
  });

  it("hardDelete() deletes the row and cascades to its versions; null for unknown id", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "harddelete");
    const documents = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);
    const doc = await documents.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      createdBy: user.id,
    });
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

    const deleted = await documents.hardDelete(doc.id);
    expect(deleted?.id).toBe(doc.id);

    expect(await documents.findById(doc.id)).toBeNull();
    expect(await versions.listByDocument(doc.id)).toEqual([]);

    const missing = await documents.hardDelete(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missing).toBeNull();
  });

  it("scopes every read/list to the bound org — a foreign-org document is invisible", async () => {
    const { org: orgA } = await seedOrgAndUser({ orgs, users }, "isoa");
    const { org: orgB, user: userB } = await seedOrgAndUser(
      { orgs, users },
      "isob",
    );
    const documentsA = new DocumentRepo(db, orgA.id);
    const documentsB = new DocumentRepo(db, orgB.id);
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
    await documentsB.markActive(docB.id, versionB.id);

    expect(await documentsA.findById(docB.id)).toBeNull();
    expect(await documentsA.listByCanonicalFolder("02_Financials")).toEqual([]);
  });

  // ── Cross-tenant current-version guards (Inspector T-004 findings) ──

  it("markActive() refuses a foreign-org versionId — no cross-tenant pointer", async () => {
    const { org: orgA, user: userA } = await seedOrgAndUser(
      { orgs, users },
      "cva",
    );
    const { org: orgB, user: userB } = await seedOrgAndUser(
      { orgs, users },
      "cvb",
    );
    const documentsA = new DocumentRepo(db, orgA.id);
    const documentsB = new DocumentRepo(db, orgB.id);
    const versionsB = new DocumentVersionRepo(db, orgB.id);

    const docA = await documentsA.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "a.pdf",
      createdBy: userA.id,
    });
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
      s3Key: "k",
      uploadedBy: userB.id,
    });

    // Org A cannot activate its draft against org B's version.
    expect(await documentsA.markActive(docA.id, versionB.id)).toBeNull();
    // The doc is untouched — still draft, no current version.
    const after = await documentsA.findById(docA.id);
    expect(after?.state).toBe("draft");
    expect(after?.currentVersionId).toBeNull();
  });

  it("setCurrentVersion() refuses a foreign-org versionId", async () => {
    const { org: orgA, user: userA } = await seedOrgAndUser(
      { orgs, users },
      "sva",
    );
    const { org: orgB, user: userB } = await seedOrgAndUser(
      { orgs, users },
      "svb",
    );
    const documentsA = new DocumentRepo(db, orgA.id);
    const versionsA = new DocumentVersionRepo(db, orgA.id);
    const documentsB = new DocumentRepo(db, orgB.id);
    const versionsB = new DocumentVersionRepo(db, orgB.id);

    const docA = await documentsA.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "a.pdf",
      createdBy: userA.id,
    });
    const vA = await versionsA.create({
      documentId: docA.id,
      versionNumber: 1,
      originalFilename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: SHA_A,
      s3Key: "k",
      uploadedBy: userA.id,
    });
    await documentsA.markActive(docA.id, vA.id);

    const docB = await documentsB.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "b.pdf",
      createdBy: userB.id,
    });
    const vB = await versionsB.create({
      documentId: docB.id,
      versionNumber: 1,
      originalFilename: "b.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: SHA_A,
      s3Key: "k",
      uploadedBy: userB.id,
    });

    expect(await documentsA.setCurrentVersion(docA.id, vB.id)).toBeNull();
    // Current version pointer unchanged (still A's own version).
    expect((await documentsA.findById(docA.id))?.currentVersionId).toBe(vA.id);
  });

  it("getWithCurrentVersion() never surfaces a foreign-org version even if current_version_id points at one", async () => {
    const { org: orgA, user: userA } = await seedOrgAndUser(
      { orgs, users },
      "gwa",
    );
    const { org: orgB, user: userB } = await seedOrgAndUser(
      { orgs, users },
      "gwb",
    );
    const documentsA = new DocumentRepo(db, orgA.id);
    const documentsB = new DocumentRepo(db, orgB.id);
    const versionsB = new DocumentVersionRepo(db, orgB.id);

    const docA = await documentsA.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "a.pdf",
      createdBy: userA.id,
    });
    const docB = await documentsB.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "b.pdf",
      createdBy: userB.id,
    });
    const vB = await versionsB.create({
      documentId: docB.id,
      versionNumber: 1,
      originalFilename: "b.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: SHA_A,
      s3Key: "k",
      uploadedBy: userB.id,
    });

    // Force the cross-tenant pointer directly in the DB, bypassing the
    // repo write-guard, to prove the READ path is independently safe.
    await db
      .update(schema.documents)
      .set({ currentVersionId: vB.id })
      .where(eq(schema.documents.id, docA.id));

    const result = await documentsA.getWithCurrentVersion(docA.id);
    expect(result?.document.id).toBe(docA.id);
    // The join is scoped to org A, so B's version is filtered out.
    expect(result?.currentVersion).toBeNull();
  });

  it("setCurrentVersion() refuses a same-org version belonging to a different document", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "wrongdoc");
    const docs = new DocumentRepo(db, org.id);
    const versions = new DocumentVersionRepo(db, org.id);

    const doc1 = await docs.create({
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "1.pdf",
      createdBy: user.id,
    });
    const v1 = await versions.create({
      documentId: doc1.id,
      versionNumber: 1,
      originalFilename: "1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: SHA_A,
      s3Key: "k",
      uploadedBy: user.id,
    });
    await docs.markActive(doc1.id, v1.id);

    // A different document (same org) with its own version.
    const doc2 = await docs.create({
      folderKind: "canonical",
      canonicalFolder: "03_Commercial",
      displayName: "2.pdf",
      createdBy: user.id,
    });
    const v2 = await versions.create({
      documentId: doc2.id,
      versionNumber: 1,
      originalFilename: "2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: SHA_A,
      s3Key: "k2",
      uploadedBy: user.id,
    });

    // doc1 cannot adopt doc2's version even though both are same-org.
    expect(await docs.setCurrentVersion(doc1.id, v2.id)).toBeNull();
    expect((await docs.findById(doc1.id))?.currentVersionId).toBe(v1.id);
  });
});
