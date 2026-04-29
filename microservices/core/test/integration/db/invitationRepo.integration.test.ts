// Integration tests for `InvitationRepo`.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

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
  let invitations: InvitationRepo;
  let users: UserRepo;
  let orgs: OrgRepo;

  beforeAll(async () => {
    await applyMigrations();
    const db = drizzle(getTestPool(), { schema });
    invitations = new InvitationRepo(db);
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

  it("create() inserts an internal invitation with role + null opportunitySlug", async () => {
    const { org, inviter } = await seedOrgAndInviter("internal");
    const inv = await invitations.create({
      workosInvitationId: "inv_workos_internal",
      orgId: org.id,
      email: "callee@example.com",
      kind: "internal",
      role: "internal",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    expect(inv.kind).toBe("internal");
    expect(inv.role).toBe("internal");
    expect(inv.opportunitySlug).toBeNull();
    expect(inv.state).toBe("pending");
  });

  it("create() inserts an external invitation with opportunitySlug + null role", async () => {
    const { org, inviter } = await seedOrgAndInviter("external");
    const inv = await invitations.create({
      workosInvitationId: "inv_workos_external",
      orgId: org.id,
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

  it("findById() returns the row when present and null otherwise", async () => {
    const { org, inviter } = await seedOrgAndInviter("findbyid");
    const inserted = await invitations.create({
      workosInvitationId: "inv_workos_findbyid",
      orgId: org.id,
      email: "findbyid@example.com",
      kind: "internal",
      role: "admin",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    const fetched = await invitations.findById(inserted.id);
    expect(fetched?.id).toBe(inserted.id);
    expect(
      await invitations.findById("00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });

  it("findByWorkosInvitationId() supports the webhook lookup path", async () => {
    const { org, inviter } = await seedOrgAndInviter("findbyworkos");
    await invitations.create({
      workosInvitationId: "inv_workos_findwk",
      orgId: org.id,
      email: "findwk@example.com",
      kind: "internal",
      role: "internal",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    const found =
      await invitations.findByWorkosInvitationId("inv_workos_findwk");
    expect(found?.email).toBe("findwk@example.com");
    expect(
      await invitations.findByWorkosInvitationId("inv_workos_does_not_exist"),
    ).toBeNull();
  });

  it("listByOrgAndState() filters to pending only when asked", async () => {
    const { org, inviter } = await seedOrgAndInviter("listbystate");
    const pending = await invitations.create({
      workosInvitationId: "inv_workos_pending",
      orgId: org.id,
      email: "pending@example.com",
      kind: "internal",
      role: "internal",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    const accepted = await invitations.create({
      workosInvitationId: "inv_workos_accepted",
      orgId: org.id,
      email: "accepted@example.com",
      kind: "internal",
      role: "internal",
      opportunitySlug: null,
      invitedBy: inviter.id,
      expiresAt: FUTURE,
    });
    await invitations.setState(accepted.id, "accepted");

    const list = await invitations.listByOrgAndState(org.id, "pending");
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(pending.id);
  });

  it("setState() throws RepoNotFoundError for a missing invitation id", async () => {
    // Pre-fix this resolved with `undefined as Invitation`, leaving
    // downstream callers to NPE on a property access. The throw
    // surfaces the bug at the right layer.
    await expect(
      invitations.setState("00000000-0000-4000-8000-000000000000", "accepted"),
    ).rejects.toThrow(/Invitation .* not found/);
  });

  it("setState() flips pending→accepted and stamps acceptedAt", async () => {
    const { org, inviter } = await seedOrgAndInviter("setstate");
    const inv = await invitations.create({
      workosInvitationId: "inv_workos_setstate",
      orgId: org.id,
      email: "setstate@example.com",
      kind: "internal",
      role: "internal",
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
});
