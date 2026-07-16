// Tenant-isolation (slice 10) / T-006 — the load-bearing property test.
//
// NFR1 / AC-US4, and the artifact ADR-011's acceptance hinges on: no query
// issued under org A's scope may return ANY row whose effective org_id ≠ A.
// `fast-check` generates random row distributions across every backfilled
// tenant-scoped table for TWO distinct orgs, then exercises every method on
// the `scopedRepo(orgA)` bundle and asserts not a single org-B (or null-org)
// row comes back. On failure fast-check shrinks to the minimal leaking
// distribution and prints it with the reproducing seed.
//
// Runs against REAL Postgres via the existing Docker-compose integration
// harness (design §Property test: real DB, not a mock, so the actual SQL
// `WHERE org_id = $1` predicate is what's under test), and therefore lives in
// the integration suite — which is wired into CI (`Core Repository
// Integration Tests`). The bootstrap carve-out reads (bootstrapRepo.ts) are
// deliberately OUT OF SCOPE: they cross orgs by design (they discover/precede
// the tenant context), so they are not part of the "scoped read" surface this
// invariant governs — see T-004 / design "Identity & the bootstrap path".

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";
import { schema } from "@ai-data-room/db";
import type { InvitationState } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { scopedRepo } from "../../../src/infrastructure/db/scoped";
import { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import { UserRepo } from "../../../src/infrastructure/db/userRepo";
import { seedAuditEvents, seedOrgAndUser } from "./fixtures";

const INVITE_STATES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const satisfies readonly InvitationState[];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Per-org random distribution. Small bounds keep each of the ~30 fast-check
// runs cheap against real Postgres while still varying "0 rows", "one of
// each", and "several" across every table.
interface OrgDist {
  members: number;
  invites: InvitationState[];
  grants: number;
  audits: number;
}

const orgDist: fc.Arbitrary<OrgDist> = fc.record({
  members: fc.integer({ min: 0, max: 3 }), // extra member users (idx 0 = owner)
  invites: fc.array(fc.constantFrom(...INVITE_STATES), { maxLength: 4 }),
  grants: fc.integer({ min: 0, max: 3 }),
  audits: fc.integer({ min: 0, max: 3 }),
});

describe("Cross-tenant isolation property (T-006, NFR1 / AC-US4)", () => {
  let db: PostgresJsDatabase<typeof schema>;
  let orgs: OrgRepo;
  let users: UserRepo;
  // Process-wide monotonic counter → globally-unique workos ids / emails /
  // slugs, so seeds never collide across fast-check runs even though the
  // rows are truncated between them.
  let seq = 0;
  const uniq = () => `t6_${seq++}`;

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

  /** Seed one org (+ a base user for FK refs) and its generated rows across
   *  every tenant-scoped table. Returns the org id + the ids a scoped read
   *  from ANOTHER org must never surface. */
  async function seedOrg(dist: OrgDist) {
    const tag = uniq();
    const { org, user: base } = await seedOrgAndUser({ orgs, users }, tag);
    const scoped = scopedRepo(org.id, db);

    // Memberships: `members` distinct users; idx 0 is the (single) owner,
    // the rest viewers — respects the single-owner-per-org partial unique.
    const memberUserIds: string[] = [];
    for (let i = 0; i < dist.members; i++) {
      const u = await users.create({
        workosUserId: `user_${uniq()}`,
        email: `${uniq()}@example.com`,
      });
      await scoped.membership.create({
        userId: u.id,
        role: i === 0 ? "owner" : "viewer",
      });
      memberUserIds.push(u.id);
    }

    // Invitations: one per generated state, all internal/viewer. Track the
    // state too so the cross-tenant write-isolation check below can re-read
    // B's PENDING invites and prove an A-scoped transition left them untouched.
    const invitations: { id: string; state: InvitationState }[] = [];
    for (const state of dist.invites) {
      const inv = await scoped.invitations.create({
        workosInvitationId: `inv_${uniq()}`,
        email: `${uniq()}@example.com`,
        kind: "internal",
        role: "viewer",
        opportunitySlug: null,
        invitedBy: base.id,
        expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
      });
      if (state !== "pending") {
        await scoped.invitations.setState(inv.id, state);
      }
      invitations.push({ id: inv.id, state });
    }

    // External grants (each to a fresh external user).
    for (let i = 0; i < dist.grants; i++) {
      const ext = await users.create({
        workosUserId: `user_${uniq()}`,
        email: `${uniq()}@example.com`,
      });
      await scoped.externalGrants.create({
        userId: ext.id,
        opportunitySlug: `opp-${uniq()}`,
        grantedBy: base.id,
        expiresAt: new Date(Date.now() + NINETY_DAYS_MS),
      });
    }

    // Audit events (via the unscoped writer, exactly as production records).
    if (dist.audits > 0) {
      await seedAuditEvents(
        db,
        Array.from({ length: dist.audits }, (_, i) => ({
          occurredAt: new Date(Date.now() - i * 1000),
          eventType: "login_success" as const,
          outcome: "success" as const,
          orgId: org.id,
          actorUserId: base.id,
        })),
      );
    }

    return { orgId: org.id, memberUserIds, invitations };
  }

  it("no scoped read under org A ever returns an org-B (or null-org) row", async () => {
    await fc.assert(
      fc.asyncProperty(orgDist, orgDist, async (aDist, bDist) => {
        // Fresh DB per run — the property owns its whole world.
        await truncateAllTables();

        const a = await seedOrg(aDist);
        const b = await seedOrg(bDist);
        // A null-org system audit row (logout of an unprovisioned user, etc.)
        // — a scoped read must exclude it too (registry note on audit_events).
        await seedAuditEvents(db, [
          {
            occurredAt: new Date(),
            eventType: "logout",
            outcome: "success",
            orgId: null,
          },
        ]);

        const scopedA = scopedRepo(a.orgId, db);

        // Collect the org_id of every row every scoped READ returns under A.
        const seenOrgIds: (string | null)[] = [];

        const members = await scopedA.membership.list();
        seenOrgIds.push(...members.map((m) => m.orgId));

        // findOwner's own isolation rides on the shared `scoped()` helper
        // (a predicate break there is caught by the list() checks above, and
        // by the tripwire in T-005). Its result still feeds `seenOrgIds`, so a
        // findOwner that returned B's owner would trip `not.toContain(b.orgId)`
        // — the only residual blind spot is a findOwner-ONLY divergence when
        // BOTH orgs have an owner and heap order happens to return A's first.
        const owner = await scopedA.membership.findOwner();
        if (owner) seenOrgIds.push(owner.orgId);

        for (const state of INVITE_STATES) {
          const invs = await scopedA.invitations.listByState(state);
          seenOrgIds.push(...invs.map((i) => i.orgId));
        }

        const grants = await scopedA.externalGrants.list();
        seenOrgIds.push(...grants.map((g) => g.orgId));

        const audits = await scopedA.auditReads.list({ limit: 200 });
        seenOrgIds.push(...audits.map((e) => e.orgId));

        // THE invariant: nothing org-B, nothing null-org, everything org-A.
        expect(seenOrgIds).not.toContain(b.orgId);
        expect(seenOrgIds).not.toContain(null);
        expect(seenOrgIds.every((id) => id === a.orgId)).toBe(true);

        // Cross-tenant PK reads (findById / findMember for B's ids) must miss
        // under A's scope, not leak the foreign row.
        for (const bInv of b.invitations) {
          expect(await scopedA.invitations.findById(bInv.id)).toBeNull();
        }
        for (const bUserId of b.memberUserIds) {
          expect(await scopedA.membership.findMember(bUserId)).toBeNull();
        }

        // Cross-tenant WRITE isolation: a scoped state-transition on B's
        // invitation is a no-op under A. The `toBeNull()` alone is ambiguous
        // (null also means "not pending"), so for B's PENDING invites we
        // additionally re-read under B's own scope and assert the row is
        // untouched — a broken predicate on transitionState would have
        // revoked it, and this catches that deterministically.
        const scopedB = scopedRepo(b.orgId, db);
        for (const bInv of b.invitations) {
          expect(
            await scopedA.invitations.transitionState(
              bInv.id,
              "pending",
              "revoked",
            ),
          ).toBeNull();
          if (bInv.state === "pending") {
            const untouched = await scopedB.invitations.findById(bInv.id);
            expect(untouched?.state).toBe("pending");
          }
        }
      }),
      // Bounded so the real-DB round-trips stay CI-cheap; still enough random
      // distributions (incl. shrinking on failure) to be meaningful.
      { numRuns: 30 },
    );
  });
});
