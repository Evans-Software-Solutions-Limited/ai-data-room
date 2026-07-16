// Integration tests for the Opportunity CRUD application functions
// (room-and-folders / T-006) against a real Postgres instance.
//
// Establishes the app-layer integration pattern: build deps from REAL
// scoped repos via `scopedRepo(orgId, db)` (rather than mocking), and
// exercise the two behaviours that only a real DB can prove:
//
//   1. FR5 — rename preserves referencing data (a `documents` row keeps
//      its `opportunity_id` — documents reference the id, not the slug).
//   2. FR6 — archive revokes exactly the archived subroom's active
//      grants (same slug, same org) in the same transaction as the
//      archive, and starts the retention clock (`archived_at` set).
//
// Plus a cross-tenant guard: archiving org A's opportunity must not
// touch an identically-slugged grant that belongs to org B.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";
import { schema } from "@ai-data-room/db";

import { AuditRepo } from "../../../src/infrastructure/db/auditRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { scopedRepo } from "../../../src/infrastructure/db/scoped";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import {
  archiveOpportunity,
  createOpportunity,
  renameOpportunity,
} from "../../../src/application/room/opportunities";
import { seedOrgAndUser } from "../db/fixtures";

const AUDIT_CTX = { sourceIp: "127.0.0.1", userAgent: "vitest" } as const;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ninetyDaysFromNow = () => new Date(Date.now() + NINETY_DAYS_MS);

describe("Opportunity CRUD application flows (integration)", () => {
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

  it("renameOpportunity preserves a referencing document's opportunityId (FR5)", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "rename");
    const scoped = scopedRepo(org.id, db);
    const auditRepo = new AuditRepo(db);
    const deps = {
      db,
      opportunities: scoped.opportunities,
      externalGrants: scoped.externalGrants,
      auditRepo,
    };

    const opp = await createOpportunity(
      {
        slug: "Vendor_A",
        name: "Vendor A",
        actorUserId: user.id,
        audit: AUDIT_CTX,
      },
      deps,
    );

    const [document] = await db
      .insert(schema.documents)
      .values({
        orgId: org.id,
        folderKind: "opportunity",
        opportunityId: opp.id,
        displayName: "NDA.pdf",
        state: "active",
        createdBy: user.id,
      })
      .returning();
    expect(document).toBeDefined();

    const renamed = await renameOpportunity(
      {
        id: opp.id,
        slug: "Vendor_A_Renamed",
        name: "Vendor A (renamed)",
        actorUserId: user.id,
        audit: AUDIT_CTX,
      },
      deps,
    );

    expect(renamed.slug).toBe("Vendor_A_Renamed");
    expect(renamed.name).toBe("Vendor A (renamed)");

    const [reloadedDocument] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, document!.id));
    // The document still points at the same opportunity id — no data
    // loss from the rename, because documents reference the id, not
    // the slug.
    expect(reloadedDocument?.opportunityId).toBe(opp.id);
  });

  it("archiveOpportunity revokes same-slug active grants, spares a different slug, and audits (FR6)", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "archive");
    const scoped = scopedRepo(org.id, db);
    const auditRepo = new AuditRepo(db);
    const deps = {
      db,
      opportunities: scoped.opportunities,
      externalGrants: scoped.externalGrants,
      auditRepo,
    };

    const opp = await createOpportunity(
      {
        slug: "Vendor_B",
        name: "Vendor B",
        actorUserId: user.id,
        audit: AUDIT_CTX,
      },
      deps,
    );

    const grantee1 = await users.create({
      workosUserId: "user_workos_grantee1",
      email: "grantee1@example.com",
    });
    const grantee2 = await users.create({
      workosUserId: "user_workos_grantee2",
      email: "grantee2@example.com",
    });
    const otherGrantee = await users.create({
      workosUserId: "user_workos_othergrantee",
      email: "othergrantee@example.com",
    });

    const grant1 = await scoped.externalGrants.create({
      userId: grantee1.id,
      opportunitySlug: opp.slug,
      grantedBy: user.id,
      expiresAt: ninetyDaysFromNow(),
    });
    const grant2 = await scoped.externalGrants.create({
      userId: grantee2.id,
      opportunitySlug: opp.slug,
      grantedBy: user.id,
      expiresAt: ninetyDaysFromNow(),
    });
    // A grant on a DIFFERENT slug within the same org — must survive.
    const otherSlugGrant = await scoped.externalGrants.create({
      userId: otherGrantee.id,
      opportunitySlug: "Vendor_Other",
      grantedBy: user.id,
      expiresAt: ninetyDaysFromNow(),
    });

    const result = await archiveOpportunity(
      { id: opp.id, actorUserId: user.id, audit: AUDIT_CTX },
      deps,
    );

    expect(result.opportunity.status).toBe("archived");
    expect(result.opportunity.archivedAt).not.toBeNull();
    expect(result.grantsRevoked).toBe(2);

    const [reloadedGrant1] = await db
      .select()
      .from(schema.externalAccessGrants)
      .where(eq(schema.externalAccessGrants.id, grant1.id));
    const [reloadedGrant2] = await db
      .select()
      .from(schema.externalAccessGrants)
      .where(eq(schema.externalAccessGrants.id, grant2.id));
    const [reloadedOtherSlugGrant] = await db
      .select()
      .from(schema.externalAccessGrants)
      .where(eq(schema.externalAccessGrants.id, otherSlugGrant.id));

    expect(reloadedGrant1?.status).toBe("revoked");
    expect(reloadedGrant2?.status).toBe("revoked");
    expect(reloadedOtherSlugGrant?.status).toBe("active");

    const archivedAuditRows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, "opportunity_archived"));
    expect(archivedAuditRows).toHaveLength(1);
    expect(archivedAuditRows[0]?.outcome).toBe("success");
  });

  it("archive after rename still revokes the grant — rename re-keys it (FR5→FR6 regression)", async () => {
    // The bug ADR-014 + Inspector Brad flagged: grants key on the mutable
    // slug, so a rename-then-archive would silently miss them. Prove the
    // rename re-keys the grant and the subsequent archive revokes it.
    const { org, user } = await seedOrgAndUser({ orgs, users }, "renamearch");
    const scoped = scopedRepo(org.id, db);
    const auditRepo = new AuditRepo(db);
    const deps = {
      db,
      opportunities: scoped.opportunities,
      externalGrants: scoped.externalGrants,
      auditRepo,
    };

    const opp = await createOpportunity(
      {
        slug: "Vendor_C",
        name: "Vendor C",
        actorUserId: user.id,
        audit: AUDIT_CTX,
      },
      deps,
    );

    const grantee = await users.create({
      workosUserId: "user_workos_renamearch_grantee",
      email: "renamearch_grantee@example.com",
    });
    const grant = await scoped.externalGrants.create({
      userId: grantee.id,
      opportunitySlug: "Vendor_C", // captured at the OLD slug
      grantedBy: user.id,
      expiresAt: ninetyDaysFromNow(),
    });

    await renameOpportunity(
      {
        id: opp.id,
        slug: "Vendor_C_v2",
        actorUserId: user.id,
        audit: AUDIT_CTX,
      },
      deps,
    );

    // FR5: rename preserved the grant by re-keying it to the new slug,
    // still active.
    const [afterRename] = await db
      .select()
      .from(schema.externalAccessGrants)
      .where(eq(schema.externalAccessGrants.id, grant.id));
    expect(afterRename?.opportunitySlug).toBe("Vendor_C_v2");
    expect(afterRename?.status).toBe("active");

    const result = await archiveOpportunity(
      { id: opp.id, actorUserId: user.id, audit: AUDIT_CTX },
      deps,
    );

    // FR6: archive-after-rename now finds and revokes the grant (was the bug).
    expect(result.grantsRevoked).toBe(1);
    const [afterArchive] = await db
      .select()
      .from(schema.externalAccessGrants)
      .where(eq(schema.externalAccessGrants.id, grant.id));
    expect(afterArchive?.status).toBe("revoked");
  });

  it("does not revoke an identically-slugged grant belonging to a different org (cross-tenant)", async () => {
    const { org: orgA, user: userA } = await seedOrgAndUser(
      { orgs, users },
      "tenanta",
    );
    const { org: orgB, user: userB } = await seedOrgAndUser(
      { orgs, users },
      "tenantb",
    );
    const scopedA = scopedRepo(orgA.id, db);
    const scopedB = scopedRepo(orgB.id, db);
    const auditRepo = new AuditRepo(db);

    const oppA = await createOpportunity(
      {
        slug: "Shared_Slug",
        name: "Org A Deal",
        actorUserId: userA.id,
        audit: AUDIT_CTX,
      },
      { db, opportunities: scopedA.opportunities, auditRepo },
    );
    // Org B's opportunity with the SAME slug — per-org uniqueness only.
    await createOpportunity(
      {
        slug: "Shared_Slug",
        name: "Org B Deal",
        actorUserId: userB.id,
        audit: AUDIT_CTX,
      },
      { db, opportunities: scopedB.opportunities, auditRepo },
    );

    const granteeB = await users.create({
      workosUserId: "user_workos_granteeB",
      email: "granteeB@example.com",
    });
    const grantB = await scopedB.externalGrants.create({
      userId: granteeB.id,
      opportunitySlug: "Shared_Slug",
      grantedBy: userB.id,
      expiresAt: ninetyDaysFromNow(),
    });

    await archiveOpportunity(
      { id: oppA.id, actorUserId: userA.id, audit: AUDIT_CTX },
      {
        db,
        opportunities: scopedA.opportunities,
        externalGrants: scopedA.externalGrants,
        auditRepo,
      },
    );

    const [reloadedGrantB] = await db
      .select()
      .from(schema.externalAccessGrants)
      .where(eq(schema.externalAccessGrants.id, grantB.id));
    // Org B's grant is untouched by org A's archive, despite the
    // identical slug — the revoke is scoped to org A via the bound
    // `externalGrants` repo.
    expect(reloadedGrantB?.status).toBe("active");
  });
});
