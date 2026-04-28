// Shared seed helpers for repo integration tests.
//
// Each test file would otherwise re-roll its own
// `seedOrgAndUser` / `seedOrgAndInviter` / `seedOrgAndActor` with
// nearly the same shape. Centralising lets us tighten the contract
// in one place — any future field additions to organizations / users
// (a `region` column, say) thread through here, not five test files.
//
// The helpers take the repos they depend on as an argument rather
// than constructing fresh ones — keeps the test files in control of
// `Db` / pool lifecycle, and makes it possible to seed inside a
// transaction once the application layer (T-008+) introduces them.

import type { Db } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  AuditEvent,
  AuditEventType,
  AuditOutcome,
  Org,
  User,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import type { OrgRepo } from "../../../src/infrastructure/db/orgRepo";
import type { UserRepo } from "../../../src/infrastructure/db/userRepo";

export interface SeedRepos {
  orgs: OrgRepo;
  users: UserRepo;
}

/**
 * Seed one org and one user, deterministically named off `suffix` so
 * tests within the same file (or table) don't collide. Returns the
 * full domain objects — callers destructure `.id` themselves rather
 * than us pre-flattening, because some tests want the full shape
 * (e.g. invitation tests check `inviter.id`) and others want only
 * IDs (membership tests).
 */
export async function seedOrgAndUser(
  repos: SeedRepos,
  suffix: string,
): Promise<{ org: Org; user: User }> {
  const org = await repos.orgs.create({
    workosOrgId: `org_workos_${suffix}`,
    name: `Org ${suffix}`,
    slug: `org-${suffix}`,
  });
  const user = await repos.users.create({
    workosUserId: `user_workos_${suffix}`,
    email: `${suffix}@example.com`,
  });
  return { org, user };
}

/**
 * Spec for one audit event to seed. Mirrors the persisted columns
 * one-to-one because the AuditRepo's `write()` API doesn't expose
 * `occurredAt` (production callers always default to `now()`); tests
 * that need monotonic timestamps go through this helper to insert
 * directly via drizzle and bypass the repo's default-stamping.
 */
export interface AuditEventSpec {
  occurredAt: Date;
  eventType: AuditEventType;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  targetUserId?: string | null;
  orgId?: string | null;
  sourceIp?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Batch-insert audit events with explicit `occurredAt` timestamps.
 * Lets pagination / ordering tests express "events 100ms apart"
 * without relying on `setTimeout` sleeps between writes — sleeps
 * pad CI runtime and depend on the host clock advancing past
 * Postgres's microsecond-resolution `now()`.
 *
 * Returns the inserted rows in input order.
 */
export async function seedAuditEvents(
  db: Db,
  events: AuditEventSpec[],
): Promise<AuditEvent[]> {
  if (events.length === 0) return [];
  const rows = await db
    .insert(schema.auditEvents)
    .values(
      events.map((e) => ({
        occurredAt: e.occurredAt,
        eventType: e.eventType,
        outcome: e.outcome,
        actorUserId: e.actorUserId ?? null,
        targetUserId: e.targetUserId ?? null,
        orgId: e.orgId ?? null,
        sourceIp: e.sourceIp ?? "203.0.113.5",
        userAgent: e.userAgent ?? "test/1.0",
        metadata: e.metadata ?? {},
      })),
    )
    .returning();
  return rows as AuditEvent[];
}
