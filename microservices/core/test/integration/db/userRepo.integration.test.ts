// Integration tests for `UserRepo`. Each method gets a happy-path
// case + the failure mode (or invariant) that's specific to it.
//
// All tests run against the local docker-compose Postgres
// (`packages/db/test/integration/docker-compose.yml`) or the GHA
// Postgres service container in CI. Pool / migrations / truncate
// helpers come from the shared scaffold exposed by
// `@ai-data-room/db/test/integration/setup`.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";
import { schema } from "@ai-data-room/db";

import { UserRepo } from "../../../src/infrastructure/db/userRepo";

describe("UserRepo (integration)", () => {
  let repo: UserRepo;

  beforeAll(async () => {
    await applyMigrations();
    const db = drizzle(getTestPool(), { schema });
    repo = new UserRepo(db);
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  it("create() inserts a row with sensible defaults", async () => {
    const user = await repo.create({
      workosUserId: "user_workos_create",
      email: "alice@example.com",
      fullName: "Alice Example",
    });
    expect(user.email).toBe("alice@example.com");
    expect(user.lifecycleState).toBe("active");
    expect(user.emailVerifiedAt).toBeNull();
  });

  it("findById() returns the row when present and null otherwise", async () => {
    const inserted = await repo.create({
      workosUserId: "user_workos_findbyid",
      email: "findbyid@example.com",
    });
    const fetched = await repo.findById(inserted.id);
    expect(fetched?.id).toBe(inserted.id);

    const missing = await repo.findById("00000000-0000-4000-8000-000000000000");
    expect(missing).toBeNull();
  });

  it("findByWorkosUserId() exchanges a WorkOS ID for our row", async () => {
    await repo.create({
      workosUserId: "user_workos_lookup",
      email: "lookup@example.com",
    });
    const found = await repo.findByWorkosUserId("user_workos_lookup");
    expect(found?.email).toBe("lookup@example.com");

    const missing = await repo.findByWorkosUserId("user_workos_does_not_exist");
    expect(missing).toBeNull();
  });

  it("findByEmail() is case-insensitive (citext)", async () => {
    await repo.create({
      workosUserId: "user_workos_caseinsens",
      email: "Casey@Example.com",
    });
    const lower = await repo.findByEmail("casey@example.com");
    const upper = await repo.findByEmail("CASEY@EXAMPLE.COM");
    expect(lower?.workosUserId).toBe("user_workos_caseinsens");
    expect(upper?.workosUserId).toBe("user_workos_caseinsens");
  });

  it("setLifecycleState() flips active→suspended and bumps updatedAt", async () => {
    const user = await repo.create({
      workosUserId: "user_workos_lifecycle",
      email: "lifecycle@example.com",
    });
    const before = user.updatedAt.getTime();
    // Sleep one ms so updatedAt monotonically advances on the test
    // clock — Postgres `now()` has microsecond resolution but JS
    // Date does not, so back-to-back calls can collide.
    await new Promise((r) => setTimeout(r, 2));
    const updated = await repo.setLifecycleState(user.id, "suspended");
    expect(updated.lifecycleState).toBe("suspended");
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it("setMfaEnrolledAt() records the enrolment timestamp", async () => {
    const user = await repo.create({
      workosUserId: "user_workos_mfa",
      email: "mfa@example.com",
    });
    const enrolledAt = new Date("2026-04-29T10:00:00Z");
    const updated = await repo.setMfaEnrolledAt(user.id, enrolledAt);
    expect(updated.mfaEnrolledAt?.toISOString()).toBe(enrolledAt.toISOString());
  });

  it("setEmailVerifiedAt() records the verification timestamp", async () => {
    const user = await repo.create({
      workosUserId: "user_workos_verified",
      email: "verified@example.com",
    });
    const verifiedAt = new Date("2026-04-29T11:00:00Z");
    const updated = await repo.setEmailVerifiedAt(user.id, verifiedAt);
    expect(updated.emailVerifiedAt?.toISOString()).toBe(
      verifiedAt.toISOString(),
    );
  });

  it("scrubPii() nulls PII columns and flips lifecycleState to deleted", async () => {
    const user = await repo.create({
      workosUserId: "user_workos_gdpr",
      email: "gdpr@example.com",
      fullName: "GDPR Subject",
    });
    const tombstone = await repo.scrubPii(user.id);
    expect(tombstone.email).toBeNull();
    expect(tombstone.fullName).toBeNull();
    expect(tombstone.lifecycleState).toBe("deleted");
    // workos_user_id is intentionally retained as a tombstone so
    // audit_events.target_user_id joins still resolve.
    expect(tombstone.workosUserId).toBe("user_workos_gdpr");
  });

  // The four setters share the same "throw if WHERE matches no rows"
  // contract from `firstOrThrow` — pre-fix they silently returned
  // `undefined as User`, leaving callers to crash far from the
  // source. One parameterised test per setter keeps the contract
  // honest without per-test boilerplate.
  describe.each([
    {
      method: "setLifecycleState",
      run: (id: string) => repo.setLifecycleState(id, "suspended"),
    },
    {
      method: "setMfaEnrolledAt",
      run: (id: string) => repo.setMfaEnrolledAt(id, new Date()),
    },
    {
      method: "setEmailVerifiedAt",
      run: (id: string) => repo.setEmailVerifiedAt(id, new Date()),
    },
    {
      method: "scrubPii",
      run: (id: string) => repo.scrubPii(id),
    },
  ])("$method() on a missing id", ({ run }) => {
    it("throws RepoNotFoundError instead of silently returning undefined", async () => {
      const missingId = "00000000-0000-4000-8000-000000000000";
      await expect(run(missingId)).rejects.toThrow(/User .* not found/);
    });
  });
});
