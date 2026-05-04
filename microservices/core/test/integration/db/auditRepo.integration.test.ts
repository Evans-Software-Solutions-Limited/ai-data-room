// Integration tests for `AuditRepo`.

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
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedAuditEvents, seedOrgAndUser } from "./fixtures";

describe("AuditRepo (integration)", () => {
  let db: PostgresJsDatabase<typeof schema>;
  let audit: AuditRepo;
  let users: UserRepo;
  let orgs: OrgRepo;

  beforeAll(async () => {
    await applyMigrations();
    db = drizzle(getTestPool(), { schema });
    audit = new AuditRepo(db);
    users = new UserRepo(db);
    orgs = new OrgRepo(db);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  // The "user" returned by seedOrgAndUser plays the actor role here.
  async function seedOrgAndActor(suffix: string) {
    const { org, user } = await seedOrgAndUser({ orgs, users }, suffix);
    return { org, actor: user };
  }

  it("write() persists every column including nullable actor/target/org", async () => {
    const event = await audit.write({
      eventType: "signup",
      outcome: "success",
      actorUserId: null,
      targetUserId: null,
      orgId: null,
      sourceIp: "203.0.113.5",
      userAgent: "test/1.0",
      metadata: { workosUserId: "user_workos_freshly_signed_up" },
    });
    expect(event.eventType).toBe("signup");
    expect(event.outcome).toBe("success");
    expect(event.actorUserId).toBeNull();
    expect(event.metadata).toMatchObject({
      workosUserId: "user_workos_freshly_signed_up",
    });
  });

  it("write() defaults metadata to {} when omitted", async () => {
    const event = await audit.write({
      eventType: "logout",
      outcome: "success",
      sourceIp: "203.0.113.5",
      userAgent: "test/1.0",
    });
    expect(event.metadata).toEqual({});
  });

  it("listByOrg() returns events newest-first within the org", async () => {
    const { org, actor } = await seedOrgAndActor("listbyorg");
    // Explicit timestamps 1s apart so the desc sort is unambiguous
    // without depending on the host clock advancing between writes.
    const base = new Date("2026-04-29T10:00:00Z").getTime();
    await seedAuditEvents(
      db,
      (["login_success", "invite_sent", "logout"] as const).map(
        (eventType, idx) => ({
          eventType,
          outcome: "success" as const,
          actorUserId: actor.id,
          orgId: org.id,
          occurredAt: new Date(base + idx * 1000),
        }),
      ),
    );

    const list = await audit.listByOrg(org.id);
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.eventType)).toEqual([
      "logout",
      "invite_sent",
      "login_success",
    ]);
  });

  it("listByOrg() honours the limit and the keyset cursor", async () => {
    const { org, actor } = await seedOrgAndActor("paginate");
    const base = new Date("2026-04-29T10:00:00Z").getTime();
    await seedAuditEvents(
      db,
      Array.from({ length: 5 }, (_, idx) => ({
        eventType: "login_success" as const,
        outcome: "success" as const,
        actorUserId: actor.id,
        orgId: org.id,
        metadata: { idx },
        occurredAt: new Date(base + idx * 1000),
      })),
    );

    const page1 = await audit.listByOrg(org.id, { limit: 2 });
    expect(page1).toHaveLength(2);
    const cursor = page1[page1.length - 1];

    const page2 = await audit.listByOrg(org.id, {
      limit: 2,
      before: { occurredAt: cursor!.occurredAt, id: cursor!.id },
    });
    expect(page2).toHaveLength(2);
    // No overlap between pages.
    const seenIds = new Set([...page1, ...page2].map((e) => e.id));
    expect(seenIds.size).toBe(4);
  });

  it("listByOrg() pagination respects the (occurredAt, id) tiebreaker", async () => {
    // Pagination correctness when events share a timestamp. JS `Date`
    // resolution is millisecond, so a busy second can produce many
    // rows with the same `occurredAt`; without the id tiebreaker, the
    // page boundary would silently drop events on the cursor's
    // timestamp.
    const { org, actor } = await seedOrgAndActor("tiebreak");
    const t0 = new Date("2026-04-29T10:00:00Z");
    const t1 = new Date("2026-04-29T10:00:01Z");
    // Six events: two pairs share `t0`, two pairs share `t1`. The
    // cursor will land mid-cluster on the first walk.
    await seedAuditEvents(
      db,
      [t0, t0, t0, t1, t1, t1].map((occurredAt, idx) => ({
        eventType: "login_success" as const,
        outcome: "success" as const,
        actorUserId: actor.id,
        orgId: org.id,
        metadata: { idx },
        occurredAt,
      })),
    );

    const all = await audit.listByOrg(org.id);
    expect(all).toHaveLength(6);

    // Walk the events in pages of 2 via the cursor and assert no
    // event is dropped or duplicated. Page boundaries land on the
    // shared-timestamp clusters, so this is the behaviour the
    // tiebreaker has to defend.
    const seen: string[] = [];
    let cursor: { occurredAt: Date; id: string } | undefined;
    for (let page = 0; page < 3; page++) {
      const rows = await audit.listByOrg(org.id, { limit: 2, before: cursor });
      expect(rows).toHaveLength(2);
      seen.push(...rows.map((r) => r.id));
      const last = rows[rows.length - 1];
      cursor = { occurredAt: last!.occurredAt, id: last!.id };
    }
    expect(new Set(seen).size).toBe(6);
    expect(seen).toEqual(all.map((e) => e.id));
  });

  it("listByOrg() does not return events from other orgs", async () => {
    const { org: orgA, actor: actorA } = await seedOrgAndActor("scopea");
    const { org: orgB } = await seedOrgAndActor("scopeb");
    await audit.write({
      eventType: "login_success",
      outcome: "success",
      actorUserId: actorA.id,
      orgId: orgA.id,
      sourceIp: "203.0.113.5",
      userAgent: "test/1.0",
    });
    const listB = await audit.listByOrg(orgB.id);
    expect(listB).toHaveLength(0);
  });

  describe("NFR9 — audit continuity after GDPR scrub", () => {
    it("audit rows JOIN to the tombstoned user after scrubPii (PII nulled, FK still resolves)", async () => {
      // The literal T-019 DoD: "delete a user and assert PII is
      // gone but audit joins still resolve". `scrubPii` nulls
      // `email` + `fullName` and flips `lifecycleState = "deleted"`
      // but deliberately keeps `id` and `workosUserId` so
      // `audit_events.target_user_id` still resolves to the user
      // row via FK.
      const { org, actor } = await seedOrgAndActor("nfr9_continuity");

      // Plant historical audit events that target the user —
      // login_success and user_suspended, typical of an
      // active-then-suspended-then-deleted lifecycle.
      await audit.write({
        eventType: "login_success",
        outcome: "success",
        actorUserId: actor.id,
        targetUserId: actor.id,
        orgId: org.id,
        sourceIp: "203.0.113.5",
        userAgent: "test/1.0",
      });
      await audit.write({
        eventType: "user_suspended",
        outcome: "success",
        actorUserId: actor.id,
        targetUserId: actor.id,
        orgId: org.id,
        sourceIp: "203.0.113.5",
        userAgent: "test/1.0",
      });

      // Now scrub the user — this is the moment NFR9 hinges on.
      const tombstone = await users.scrubPii(actor.id);
      expect(tombstone.email).toBeNull();
      expect(tombstone.fullName).toBeNull();
      expect(tombstone.lifecycleState).toBe("deleted");

      // Plus the deletion-itself event written post-scrub against
      // the tombstoned id.
      await audit.write({
        eventType: "user_deleted",
        outcome: "success",
        targetUserId: tombstone.id,
        orgId: org.id,
        sourceIp: "203.0.113.5",
        userAgent: "test/1.0",
      });

      // The actual NFR9 assertion: a real JOIN from audit_events to
      // users on `target_user_id = users.id` resolves to the
      // tombstone row for every event. A regression where `scrubPii`
      // accidentally deleted the user row instead of nulling PII
      // would surface here as `userId === null` from the leftJoin.
      const joined = await db
        .select({
          auditId: schema.auditEvents.id,
          eventType: schema.auditEvents.eventType,
          userId: schema.users.id,
          userWorkosId: schema.users.workosUserId,
          userEmail: schema.users.email,
          userFullName: schema.users.fullName,
          userLifecycle: schema.users.lifecycleState,
        })
        .from(schema.auditEvents)
        .leftJoin(
          schema.users,
          eq(schema.auditEvents.targetUserId, schema.users.id),
        )
        .where(eq(schema.auditEvents.targetUserId, tombstone.id));

      expect(joined).toHaveLength(3);
      for (const row of joined) {
        // Join resolved — the FK target still exists.
        expect(row.userId).toBe(tombstone.id);
        // workosUserId tombstone retained — supports a future
        // webhook redelivery for the same WorkOS id resolving back
        // to this row rather than fanning out to a new mirror.
        expect(row.userWorkosId).toBe(actor.workosUserId);
        // PII gone.
        expect(row.userEmail).toBeNull();
        expect(row.userFullName).toBeNull();
        expect(row.userLifecycle).toBe("deleted");
      }
    });
  });
});
