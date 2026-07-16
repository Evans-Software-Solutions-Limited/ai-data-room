// Integration tests for `InvitationRepo`.
//
// Tenant-isolation (slice 10) / T-004: `InvitationRepo` is now a
// `ScopedRepo` subclass — each test constructs its own instance bound
// to the org it seeds. `findByWorkosInvitationId` moved to
// `bootstrapRepo.test.ts` (it runs before a tenant context exists).

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

import { InvitationRepo } from "../../../src/infrastructure/db/invitationRepo";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedOrgAndUser } from "./fixtures";

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

describe("InvitationRepo (integration)", () => {
  let db: PostgresJsDatabase<typeof schema>;
  let users: UserRepo;
  let orgs: OrgRepo;

  beforeAll(async () => {
    await applyMigrations();
    db = drizzle(getTestPool(), { schema });
    users = new UserRepo(db);
    orgs = new OrgRepo(db);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  // The "user" returned by seedOrgAndUser plays the inviter role here.
  async function seedOrgAndInviter(suffix: string) {
    const { org, user } = await seedOrgAndUser({ orgs, users }, suffix);
    return { org, inviter: user };
  }

  it("create() inserts an internal invitation with role + null opportunitySlug, stamping the bound org", async () => {
    const { org, inviter } = await seedOrgAndInviter("internal");
    const invitations = new InvitationRepo(db, org.id);
    const inv = await invitations.create({
      workosInvitationId: "inv_workos_internal",
      email: "callee@example.com",
      kind: "internal",
      role: "viewer",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    expect(inv.orgId).toBe(org.id);
    expect(inv.kind).toBe("internal");
    expect(inv.role).toBe("viewer");
    expect(inv.opportunitySlug).toBeNull();
    expect(inv.state).toBe("pending");
  });

  it("create() inserts an external invitation with opportunitySlug + null role", async () => {
    const { org, inviter } = await seedOrgAndInviter("external");
    const invitations = new InvitationRepo(db, org.id);
    const inv = await invitations.create({
      workosInvitationId: "inv_workos_external",
      email: "vendor@example.com",
      kind: "external",
      role: null,
      opportunitySlug: "vendor-a",
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    expect(inv.kind).toBe("external");
    expect(inv.opportunitySlug).toBe("vendor-a");
    expect(inv.role).toBeNull();
  });

  it("findById() returns the row when present and null otherwise (and excludes a foreign org)", async () => {
    const { org, inviter } = await seedOrgAndInviter("findbyid");
    const invitations = new InvitationRepo(db, org.id);
    const inserted = await invitations.create({
      workosInvitationId: "inv_workos_findbyid",
      email: "findbyid@example.com",
      kind: "internal",
      role: "editor",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    const fetched = await invitations.findById(inserted.id);
    expect(fetched?.id).toBe(inserted.id);
    expect(
      await invitations.findById("00000000-0000-4000-8000-000000000000"),
    ).toBeNull();

    // T-004: the same id, looked up through a DIFFERENT org's scoped
    // repo, must not resolve — this is the isolation guarantee itself.
    const { org: otherOrg } = await seedOrgAndInviter("findbyid_other");
    const otherScoped = new InvitationRepo(db, otherOrg.id);
    expect(await otherScoped.findById(inserted.id)).toBeNull();
  });

  it("listByState() filters to pending only when asked", async () => {
    const { org, inviter } = await seedOrgAndInviter("listbystate");
    const invitations = new InvitationRepo(db, org.id);
    const pending = await invitations.create({
      workosInvitationId: "inv_workos_pending",
      email: "pending@example.com",
      kind: "internal",
      role: "viewer",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    const accepted = await invitations.create({
      workosInvitationId: "inv_workos_accepted",
      email: "accepted@example.com",
      kind: "internal",
      role: "viewer",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    await invitations.setState(accepted.id, "accepted");

    const list = await invitations.listByState("pending");
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(pending.id);
  });

  it("setState() throws RepoNotFoundError for a missing invitation id", async () => {
    // Pre-fix this resolved with `undefined as Invitation`, leaving
    // downstream callers to NPE on a property access. The throw
    // surfaces the bug at the right layer.
    const { org } = await seedOrgAndInviter("setstate_missing");
    const invitations = new InvitationRepo(db, org.id);
    await expect(
      invitations.setState("00000000-0000-4000-8000-000000000000", "accepted"),
    ).rejects.toThrow(/Invitation .* not found/);
  });

  it("setState() flips pending→accepted and stamps acceptedAt", async () => {
    const { org, inviter } = await seedOrgAndInviter("setstate");
    const invitations = new InvitationRepo(db, org.id);
    const inv = await invitations.create({
      workosInvitationId: "inv_workos_setstate",
      email: "setstate@example.com",
      kind: "internal",
      role: "viewer",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    expect(inv.acceptedAt).toBeNull();
    const accepted = await invitations.setState(inv.id, "accepted");
    expect(accepted.state).toBe("accepted");
    expect(accepted.acceptedAt).not.toBeNull();

    // Flipping to a non-accepted state nulls acceptedAt out (the
    // invariant we expose: acceptedAt is meaningful only for the
    // accepted state).
    const revoked = await invitations.setState(inv.id, "revoked");
    expect(revoked.state).toBe("revoked");
    expect(revoked.acceptedAt).toBeNull();
  });

  describe("transitionState() — atomic compare-and-set against TOCTOU races", () => {
    it("transitions pending→accepted when the row is still pending and stamps acceptedAt", async () => {
      const { org, inviter } = await seedOrgAndInviter("transition_happy");
      const invitations = new InvitationRepo(db, org.id);
      const inv = await invitations.create({
        workosInvitationId: "inv_workos_transition_happy",
        email: "transition-happy@example.com",
        kind: "internal",
        role: "viewer",
        opportunitySlug: null,
        invitedBy: inviter.id,
        expiresAt: FUTURE,
      });

      const accepted = await invitations.transitionState(
        inv.id,
        "pending",
        "accepted",
      );
      expect(accepted).not.toBeNull();
      expect(accepted!.state).toBe("accepted");
      expect(accepted!.acceptedAt).not.toBeNull();
    });

    it("returns null when the expected state doesn't match (race lost)", async () => {
      // Simulates the second of two concurrent webhook deliveries:
      // the first one already moved the row to `accepted`, so the
      // second's compare-and-set against `pending` finds nothing
      // and returns null. The application layer reads this as
      // "race lost" and rolls back its in-tx multi-write.
      const { org, inviter } = await seedOrgAndInviter("transition_race");
      const invitations = new InvitationRepo(db, org.id);
      const inv = await invitations.create({
        workosInvitationId: "inv_workos_transition_race",
        email: "transition-race@example.com",
        kind: "internal",
        role: "viewer",
        opportunitySlug: null,
        invitedBy: inviter.id,
        expiresAt: FUTURE,
      });
      // First caller wins.
      await invitations.transitionState(inv.id, "pending", "accepted");

      // Second caller loses — the row is no longer pending.
      const second = await invitations.transitionState(
        inv.id,
        "pending",
        "accepted",
      );
      expect(second).toBeNull();

      // The row is still `accepted` from the first call — the
      // second call must NOT have clobbered it.
      const refetched = await invitations.findById(inv.id);
      expect(refetched?.state).toBe("accepted");
    });

    it("returns null for a missing id (no implicit insert)", async () => {
      const { org } = await seedOrgAndInviter("transition_missing");
      const invitations = new InvitationRepo(db, org.id);
      const result = await invitations.transitionState(
        "00000000-0000-4000-8000-000000000000",
        "pending",
        "accepted",
      );
      expect(result).toBeNull();
    });

    it("returns null for an id that belongs to a different org (T-004 isolation)", async () => {
      const { org, inviter } = await seedOrgAndInviter("transition_crossorg");
      const invitations = new InvitationRepo(db, org.id);
      const inv = await invitations.create({
        workosInvitationId: "inv_workos_transition_crossorg",
        email: "transition-crossorg@example.com",
        kind: "internal",
        role: "viewer",
        opportunitySlug: null,
        invitedBy: inviter.id,
        expiresAt: FUTURE,
      });

      const { org: otherOrg } = await seedOrgAndInviter(
        "transition_crossorg_other",
      );
      const otherScoped = new InvitationRepo(db, otherOrg.id);
      const result = await otherScoped.transitionState(
        inv.id,
        "pending",
        "accepted",
      );
      expect(result).toBeNull();

      // The row is untouched — still pending under its real org.
      const refetched = await invitations.findById(inv.id);
      expect(refetched?.state).toBe("pending");
    });
  });
});
