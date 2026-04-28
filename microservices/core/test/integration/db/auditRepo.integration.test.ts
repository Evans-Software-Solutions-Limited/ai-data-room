// Integration tests for `AuditRepo`.

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
});
