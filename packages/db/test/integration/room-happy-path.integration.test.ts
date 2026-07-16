// T-003 — per-table happy path + DB invariants for the room-and-folders
// schema (opportunities, documents, document_versions,
// document_deletions).
//
// Companion to `happy-path.integration.test.ts` (auth-and-orgs). Inserts
// one minimally-valid row per table and reads it back through the typed
// drizzle client, then exercises the four invariants that live in the DB,
// not in TypeScript:
//
//   1. The `documents_folder_kind_xor` CHECK — exactly one of
//      (canonical_folder, opportunity_id) is non-null and agrees with
//      folder_kind.
//   2. `opportunities (org_id, slug)` uniqueness (FR4).
//   3. `document_versions (document_id, version_number)` uniqueness
//      (FR15, append-only version numbers).
//   4. `document_versions.document_id` ON DELETE CASCADE — hard-deleting
//      a document takes its versions with it — and the circular
//      `documents.current_version_id` → `document_versions.id` FK.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "./setup";
import * as schema from "../../src/schema";

// A deterministic 32-byte sha-256 digest for the `bytea` column.
const SHA256 = Buffer.alloc(32, 0xab);

describe("room-and-folders schema — per-table happy path", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    await applyMigrations();
    db = drizzle(getTestPool(), { schema });
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  /** Seed the FK parents every room row needs: one org + one user. */
  async function seedOrgAndUser(tag = "1") {
    const [org] = await db
      .insert(schema.organizations)
      .values({
        workosOrgId: `org_workos_${tag}`,
        name: `Org ${tag}`,
        slug: `org-${tag}`,
      })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({
        workosUserId: `user_workos_${tag}`,
        email: `user${tag}@example.com`,
      })
      .returning();
    return { orgId: org!.id, userId: user!.id };
  }

  it("inserts and reads back an opportunity", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const [opp] = await db
      .insert(schema.opportunities)
      .values({ orgId, slug: "Vendor_A", name: "Vendor A", createdBy: userId })
      .returning();

    expect(opp!.status).toBe("active"); // enum default
    expect(opp!.archivedAt).toBeNull();

    const read = await db.query.opportunities.findFirst({
      where: eq(schema.opportunities.id, opp!.id),
    });
    expect(read?.slug).toBe("Vendor_A");
  });

  it("inserts a canonical-folder document (state defaults to draft)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const [doc] = await db
      .insert(schema.documents)
      .values({
        orgId,
        folderKind: "canonical",
        canonicalFolder: "02_Financials",
        displayName: "Term Sheet.pdf",
        createdBy: userId,
      })
      .returning();

    expect(doc!.state).toBe("draft");
    expect(doc!.opportunityId).toBeNull();
    expect(doc!.currentVersionId).toBeNull();
  });

  it("inserts an opportunity-folder document", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const [opp] = await db
      .insert(schema.opportunities)
      .values({ orgId, slug: "Vendor_A", name: "Vendor A", createdBy: userId })
      .returning();

    const [doc] = await db
      .insert(schema.documents)
      .values({
        orgId,
        folderKind: "opportunity",
        opportunityId: opp!.id,
        displayName: "NDA.pdf",
        createdBy: userId,
      })
      .returning();

    expect(doc!.opportunityId).toBe(opp!.id);
    expect(doc!.canonicalFolder).toBeNull();
  });

  it("inserts a document version and links it as current (circular FK)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const [doc] = await db
      .insert(schema.documents)
      .values({
        orgId,
        folderKind: "canonical",
        canonicalFolder: "02_Financials",
        displayName: "Term Sheet.pdf",
        createdBy: userId,
      })
      .returning();

    const [version] = await db
      .insert(schema.documentVersions)
      .values({
        documentId: doc!.id,
        orgId,
        versionNumber: 1,
        originalFilename: "Term Sheet.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        sha256: SHA256,
        s3Key: `orgs/${orgId}/documents/${doc!.id}/v1`,
        uploadedBy: userId,
      })
      .returning();

    expect(version!.versionNumber).toBe(1);
    expect(typeof version!.sizeBytes).toBe("number"); // bigint mode: "number"
    expect(Buffer.from(version!.sha256).equals(SHA256)).toBe(true);

    // Circular FK: point the document at its version.
    const [updated] = await db
      .update(schema.documents)
      .set({ currentVersionId: version!.id })
      .where(eq(schema.documents.id, doc!.id))
      .returning();
    expect(updated!.currentVersionId).toBe(version!.id);
  });

  it("inserts and reads back a document deletion record", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    // document_id is intentionally NOT an FK — the deletion record
    // outlives the document, so a free UUID is valid here.
    const [del] = await db
      .insert(schema.documentDeletions)
      .values({
        documentId: "99999999-9999-4999-8999-999999999999",
        orgId,
        softDeletedBy: userId,
      })
      .returning();

    expect(del!.hardDeletedAt).toBeInstanceOf(Date);
    const read = await db.query.documentDeletions.findFirst({
      where: eq(schema.documentDeletions.id, del!.id),
    });
    expect(read?.orgId).toBe(orgId);
  });

  // ── DB-enforced invariants ─────────────────────────────────────────

  it("rejects a document with neither canonical_folder nor opportunity_id (XOR)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await expect(
      db.insert(schema.documents).values({
        orgId,
        folderKind: "canonical",
        canonicalFolder: null,
        opportunityId: null,
        displayName: "orphan.pdf",
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  it("rejects a document with both canonical_folder and opportunity_id (XOR)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const [opp] = await db
      .insert(schema.opportunities)
      .values({ orgId, slug: "Vendor_A", name: "Vendor A", createdBy: userId })
      .returning();

    await expect(
      db.insert(schema.documents).values({
        orgId,
        folderKind: "canonical",
        canonicalFolder: "02_Financials",
        opportunityId: opp!.id,
        displayName: "confused.pdf",
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  it("rejects a folder_kind='opportunity' document that carries a canonical_folder (XOR)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await expect(
      db.insert(schema.documents).values({
        orgId,
        folderKind: "opportunity",
        canonicalFolder: "02_Financials",
        opportunityId: null,
        displayName: "confused.pdf",
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (org_id, slug) opportunity", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await db
      .insert(schema.opportunities)
      .values({ orgId, slug: "Vendor_A", name: "Vendor A", createdBy: userId });

    await expect(
      db.insert(schema.opportunities).values({
        orgId,
        slug: "Vendor_A",
        name: "Vendor A (dup)",
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  it("allows the same slug in a different org", async () => {
    const a = await seedOrgAndUser("a");
    const b = await seedOrgAndUser("b");
    await db.insert(schema.opportunities).values({
      orgId: a.orgId,
      slug: "Vendor_A",
      name: "Vendor A",
      createdBy: a.userId,
    });
    await expect(
      db.insert(schema.opportunities).values({
        orgId: b.orgId,
        slug: "Vendor_A",
        name: "Vendor A",
        createdBy: b.userId,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a duplicate (document_id, version_number)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const [doc] = await db
      .insert(schema.documents)
      .values({
        orgId,
        folderKind: "canonical",
        canonicalFolder: "02_Financials",
        displayName: "Term Sheet.pdf",
        createdBy: userId,
      })
      .returning();

    const versionValues = {
      documentId: doc!.id,
      orgId,
      versionNumber: 1,
      originalFilename: "v.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: SHA256,
      s3Key: "k",
      uploadedBy: userId,
    };
    await db.insert(schema.documentVersions).values(versionValues);
    await expect(
      db.insert(schema.documentVersions).values(versionValues),
    ).rejects.toThrow();
  });

  it("rejects a folder_kind='canonical' document that carries only opportunity_id (XOR)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const [opp] = await db
      .insert(schema.opportunities)
      .values({ orgId, slug: "Vendor_A", name: "Vendor A", createdBy: userId })
      .returning();

    await expect(
      db.insert(schema.documents).values({
        orgId,
        folderKind: "canonical",
        canonicalFolder: null,
        opportunityId: opp!.id,
        displayName: "confused.pdf",
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  it("rejects a folder_kind='opportunity' document with neither field set (XOR)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await expect(
      db.insert(schema.documents).values({
        orgId,
        folderKind: "opportunity",
        canonicalFolder: null,
        opportunityId: null,
        displayName: "orphan.pdf",
        createdBy: userId,
      }),
    ).rejects.toThrow();
  });

  it("cascades version deletion when its document is hard-deleted (with current_version_id linked)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const [doc] = await db
      .insert(schema.documents)
      .values({
        orgId,
        folderKind: "canonical",
        canonicalFolder: "02_Financials",
        displayName: "Term Sheet.pdf",
        createdBy: userId,
      })
      .returning();
    const [version] = await db
      .insert(schema.documentVersions)
      .values({
        documentId: doc!.id,
        orgId,
        versionNumber: 1,
        originalFilename: "v.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        sha256: SHA256,
        s3Key: "k",
        uploadedBy: userId,
      })
      .returning();

    // Link the version as current — this is the production shape the
    // retention sweep (T-010) hard-deletes: the `current_version_id`
    // NO ACTION FK points at a version that the `document_id` CASCADE
    // removes in the same statement. Proves that interaction doesn't
    // wedge the delete (Postgres checks NO ACTION at end-of-statement,
    // by which time the referencing document row is gone).
    await db
      .update(schema.documents)
      .set({ currentVersionId: version!.id })
      .where(eq(schema.documents.id, doc!.id));

    await expect(
      db.delete(schema.documents).where(eq(schema.documents.id, doc!.id)),
    ).resolves.toBeDefined();

    const remainingDocs = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, doc!.id));
    expect(remainingDocs).toHaveLength(0);

    const orphans = await db
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.documentId, doc!.id),
          eq(schema.documentVersions.orgId, orgId),
        ),
      );
    expect(orphans).toHaveLength(0);
  });

  it("rejects a second ACTIVE document with the same (org, canonical folder, name); allows a draft dup", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const base = {
      orgId,
      folderKind: "canonical" as const,
      canonicalFolder: "02_Financials",
      displayName: "dup.pdf",
      createdBy: userId,
    };
    await db.insert(schema.documents).values({ ...base, state: "active" });
    // The partial unique is `WHERE state = 'active'`, so a draft with the
    // same name coexists (upload initiate creates drafts).
    await expect(
      db.insert(schema.documents).values({ ...base, state: "draft" }),
    ).resolves.toBeDefined();
    // A second ACTIVE with the same name in the same folder is rejected —
    // the FR13 "one active doc per name" backstop.
    await expect(
      db.insert(schema.documents).values({ ...base, state: "active" }),
    ).rejects.toThrow();
  });

  it("allows the same active document name in a different canonical folder", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    await db.insert(schema.documents).values({
      orgId,
      folderKind: "canonical",
      canonicalFolder: "02_Financials",
      displayName: "x.pdf",
      state: "active",
      createdBy: userId,
    });
    await expect(
      db.insert(schema.documents).values({
        orgId,
        folderKind: "canonical",
        canonicalFolder: "03_Commercial",
        displayName: "x.pdf",
        state: "active",
        createdBy: userId,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a second ACTIVE document with the same (org, opportunity, name)", async () => {
    const { orgId, userId } = await seedOrgAndUser();
    const [opp] = await db
      .insert(schema.opportunities)
      .values({ orgId, slug: "Vendor_A", name: "Vendor A", createdBy: userId })
      .returning();
    const base = {
      orgId,
      folderKind: "opportunity" as const,
      opportunityId: opp!.id,
      displayName: "nda.pdf",
      createdBy: userId,
    };
    await db.insert(schema.documents).values({ ...base, state: "active" });
    // draft dup allowed (partial index is WHERE state='active')
    await expect(
      db.insert(schema.documents).values({ ...base, state: "draft" }),
    ).resolves.toBeDefined();
    await expect(
      db.insert(schema.documents).values({ ...base, state: "active" }),
    ).rejects.toThrow();
  });

  it("allows the same active (folder, name) in a different org", async () => {
    const a = await seedOrgAndUser("a");
    const b = await seedOrgAndUser("b");
    const doc = (orgId: string, createdBy: string) => ({
      orgId,
      folderKind: "canonical" as const,
      canonicalFolder: "02_Financials",
      displayName: "shared.pdf",
      state: "active" as const,
      createdBy,
    });
    await db.insert(schema.documents).values(doc(a.orgId, a.userId));
    await expect(
      db.insert(schema.documents).values(doc(b.orgId, b.userId)),
    ).resolves.toBeDefined();
  });
});
