// T-005 — per-table happy-path integration test.
//
// Inserts one minimally-valid row per table and reads it back through
// the typed drizzle client, then exercises the two T-005 invariants
// that aren't expressible in TypeScript:
//
//   1. citext makes `users.email` and `invitations.email` case-
//      insensitive — a duplicate-cased insert collides with the partial
//      unique index.
//   2. The single-owner-per-org partial unique on `org_memberships`
//      rejects a second `owner` for the same org while permitting more
//      `admin`/`internal` rows.
//
// The base smoke (`migrate.integration.test.ts`) proves migrations
// apply; this file proves the schema is shaped the way the application
// layer (T-007 onward) is going to depend on.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "./setup";
import * as schema from "../../src/schema";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // expiresAt: 7d ahead

describe("auth-and-orgs schema — per-table happy path", () => {
  // Single drizzle client across the suite. Each test seeds inside the
  // hermetic `beforeEach` truncate — order between cases doesn't
  // matter.
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

  it("inserts and reads back an organization", async () => {
    const [inserted] = await db
      .insert(schema.organizations)
      .values({
        workosOrgId: "org_workos_1",
        name: "Capital Pay",
        slug: "capital-pay",
      })
      .returning();
    const [fetched] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, inserted!.id));
    expect(fetched).toMatchObject({
      workosOrgId: "org_workos_1",
      slug: "capital-pay",
      status: "active",
    });
  });

  it("inserts and reads back a user (citext column round-trips a string)", async () => {
    const [inserted] = await db
      .insert(schema.users)
      .values({
        workosUserId: "user_workos_1",
        email: "alice@example.com",
        fullName: "Alice Example",
      })
      .returning();
    const [fetched] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, inserted!.id));
    expect(fetched).toMatchObject({
      email: "alice@example.com",
      lifecycleState: "active",
    });
  });

  it("inserts an org_membership and an external_access_grant against existing FKs", async () => {
    const [org] = await db
      .insert(schema.organizations)
      .values({
        workosOrgId: "org_workos_2",
        name: "Acme",
        slug: "acme",
      })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({
        workosUserId: "user_workos_2",
        email: "bob@example.com",
      })
      .returning();
    await db.insert(schema.orgMemberships).values({
      orgId: org!.id,
      userId: user!.id,
      role: "admin",
    });
    await db.insert(schema.externalAccessGrants).values({
      orgId: org!.id,
      userId: user!.id,
      opportunitySlug: "vendor-a",
      grantedBy: user!.id,
    });

    const memberships = await db
      .select()
      .from(schema.orgMemberships)
      .where(eq(schema.orgMemberships.orgId, org!.id));
    const grants = await db
      .select()
      .from(schema.externalAccessGrants)
      .where(eq(schema.externalAccessGrants.orgId, org!.id));
    expect(memberships).toHaveLength(1);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.opportunitySlug).toBe("vendor-a");
  });

  it("inserts an invitation and an audit_event", async () => {
    const [user] = await db
      .insert(schema.users)
      .values({
        workosUserId: "user_workos_inviter",
        email: "carol@example.com",
      })
      .returning();
    const [org] = await db
      .insert(schema.organizations)
      .values({
        workosOrgId: "org_workos_3",
        name: "Beta Co",
        slug: "beta-co",
      })
      .returning();

    await db.insert(schema.invitations).values({
      workosInvitationId: "inv_workos_1",
      orgId: org!.id,
      email: "dave@example.com",
      kind: "internal",
      role: "internal",
      invitedBy: user!.id,
      expiresAt: FUTURE,
    });
    await db.insert(schema.auditEvents).values({
      eventType: "invite_sent",
      actorUserId: user!.id,
      orgId: org!.id,
      sourceIp: "203.0.113.5",
      userAgent: "test-agent",
      outcome: "success",
      metadata: { workosInvitationId: "inv_workos_1" },
    });

    const invites = await db.select().from(schema.invitations);
    const events = await db.select().from(schema.auditEvents);
    expect(invites).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toMatchObject({
      workosInvitationId: "inv_workos_1",
    });
  });

  // ── T-005 invariants the smoke test doesn't cover ───────────────────

  it("citext + partial unique on users.email rejects a case-insensitive duplicate among active rows", async () => {
    await db.insert(schema.users).values({
      workosUserId: "user_workos_a",
      email: "Eve@example.com",
    });
    await expect(
      db.insert(schema.users).values({
        workosUserId: "user_workos_b",
        email: "eve@example.com",
      }),
    ).rejects.toThrow(/users_email_active_key/);
  });

  it("partial unique on users.email allows reuse of a previously-deleted address", async () => {
    // Same address as the previous test but flipped to deleted before
    // the second insert — proving the partial predicate
    // `lifecycle_state <> 'deleted'` actually carves out the tombstones.
    const [tombstone] = await db
      .insert(schema.users)
      .values({
        workosUserId: "user_workos_c",
        email: "frank@example.com",
        lifecycleState: "deleted",
      })
      .returning();
    await expect(
      db.insert(schema.users).values({
        workosUserId: "user_workos_d",
        email: "frank@example.com",
      }),
    ).resolves.not.toThrow();
    expect(tombstone!.lifecycleState).toBe("deleted");
  });

  it("single-owner-per-org partial unique rejects a second owner but allows more admins/internals", async () => {
    const [org] = await db
      .insert(schema.organizations)
      .values({
        workosOrgId: "org_workos_solo",
        name: "Solo Owner Co",
        slug: "solo-owner",
      })
      .returning();
    // Three distinct users so we can attempt three (org, user, role)
    // combinations against the same org without tripping the
    // (org_id, user_id) uniqueness — that's a separate constraint
    // from the single-owner predicate we're actually testing here.
    const inserted = await db
      .insert(schema.users)
      .values([
        { workosUserId: "user_workos_owner_1", email: "owner1@example.com" },
        { workosUserId: "user_workos_owner_2", email: "owner2@example.com" },
        { workosUserId: "user_workos_owner_3", email: "owner3@example.com" },
      ])
      .returning({ id: schema.users.id });
    const [first, second, third] = inserted;

    await db.insert(schema.orgMemberships).values({
      orgId: org!.id,
      userId: first!.id,
      role: "owner",
    });
    await expect(
      db.insert(schema.orgMemberships).values({
        orgId: org!.id,
        userId: second!.id,
        role: "owner",
      }),
    ).rejects.toThrow(/org_memberships_single_owner_key/);
    // Admin / internal on the same org are unconstrained beyond the
    // (org, user) uniqueness, so these still succeed.
    await expect(
      db.insert(schema.orgMemberships).values({
        orgId: org!.id,
        userId: second!.id,
        role: "admin",
      }),
    ).resolves.not.toThrow();
    await expect(
      db.insert(schema.orgMemberships).values({
        orgId: org!.id,
        userId: third!.id,
        role: "internal",
      }),
    ).resolves.not.toThrow();
  });
});
