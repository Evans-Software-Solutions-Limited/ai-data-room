// Integration tests for `TenantBootstrapRepo` — tenant-isolation
// (slice 10) / T-004.
//
// Covers the four reads that legitimately run BEFORE a tenant context
// exists (moved here, verbatim in logic, from the pre-T-004
// `membershipRepo.findByUser` / `.lockForUserCreate`,
// `invitationRepo.findByWorkosInvitationId`, and
// `externalGrantRepo.listByUser`). See `bootstrapRepo.ts`'s header for
// why each one is safe unscoped.

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

import { TenantBootstrapRepo } from "../../../src/infrastructure/db/bootstrapRepo";
import { ExternalGrantRepo } from "../../../src/infrastructure/db/externalGrantRepo";
import { InvitationRepo } from "../../../src/infrastructure/db/invitationRepo";
import { MembershipRepo } from "../../../src/infrastructure/db/membershipRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

describe("TenantBootstrapRepo (integration)", () => {
  let db: PostgresJsDatabase<typeof schema>;
  let bootstrap: TenantBootstrapRepo;
  let users: UserRepo;
  let orgs: OrgRepo;

  beforeAll(async () => {
    await applyMigrations();
    db = drizzle(getTestPool(), { schema });
    bootstrap = new TenantBootstrapRepo(db);
    users = new UserRepo(db);
    orgs = new OrgRepo(db);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  it("findMembershipForUser() returns the user's single membership, or null (org-provisioning FR5)", async () => {
    const { org, user } = await seedOrgAndUser({ orgs, users }, "findbyuser");
    const memberships = new MembershipRepo(db, org.id);
    await memberships.create({ userId: user.id, role: "owner" });

    const found = await bootstrap.findMembershipForUser(user.id);
    expect(found?.orgId).toBe(org.id);
    expect(found?.role).toBe("owner");

    const none = await bootstrap.findMembershipForUser(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(none).toBeNull();
  });

  it("lockForUserCreate() runs the per-user advisory lock (FR5 race guard SQL is valid)", async () => {
    const { user } = await seedOrgAndUser({ orgs, users }, "lockuser");
    // Smoke test: proves the hashtext/pg_advisory_xact_lock SQL parses
    // and executes against real Postgres. (Serialization itself is a
    // Postgres advisory-lock guarantee, exercised under the createOrg
    // transaction.)
    await expect(bootstrap.lockForUserCreate(user.id)).resolves.toBeUndefined();
  });

  it("findInvitationByWorkosId() supports the webhook lookup path, before any org context exists", async () => {
    const { org, user: inviter } = await seedOrgAndUser(
      { orgs, users },
      "findbyworkos",
    );
    const invitations = new InvitationRepo(db, org.id);
    await invitations.create({
      workosInvitationId: "inv_workos_findwk",
      email: "findwk@example.com",
      kind: "internal",
      role: "viewer",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });

    const found = await bootstrap.findInvitationByWorkosId("inv_workos_findwk");
    expect(found?.email).toBe("findwk@example.com");
    expect(found?.orgId).toBe(org.id);
    expect(
      await bootstrap.findInvitationByWorkosId("inv_workos_does_not_exist"),
    ).toBeNull();
  });

  it("listGrantsForUser() returns every grant for that user across every org", async () => {
    const { org: orgA, user } = await seedOrgAndUser(
      { orgs, users },
      "listuser_a",
    );
    const { org: orgB } = await seedOrgAndUser({ orgs, users }, "listuser_b");
    const grantsA = new ExternalGrantRepo(db, orgA.id);
    const grantsB = new ExternalGrantRepo(db, orgB.id);
    await grantsA.create({
      userId: user.id,
      opportunitySlug: "vendor-a",
      grantedBy: user.id,
      expiresAt: new Date(Date.now() + NINETY_DAYS_MS),
    });
    await grantsB.create({
      userId: user.id,
      opportunitySlug: "vendor-b",
      grantedBy: user.id,
      expiresAt: new Date(Date.now() + NINETY_DAYS_MS),
    });

    // Self-read across BOTH orgs — this is exactly why it's unscoped:
    // an external user's grants aren't bound to a single org.
    const list = await bootstrap.listGrantsForUser(user.id);
    expect(list).toHaveLength(2);
    expect(new Set(list.map((g) => g.opportunitySlug))).toEqual(
      new Set(["vendor-a", "vendor-b"]),
    );
  });
});
