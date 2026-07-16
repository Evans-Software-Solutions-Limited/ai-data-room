// Drizzle-backed repository for the `audit_events` aggregate.
//
// Slice 1 / T-007. Append-only by convention at v0.1; see design.md
// §Data model NFR10 — no `update` or `delete` methods are exposed,
// and SOC 2 entry will tighten this with a Postgres trigger. Used by
// every application-layer task that records auditable activity
// (T-008 through T-013, T-016, T-019).
//
// Tenant-isolation (slice 10) / T-004 split the writer from the org
// read: `AuditRepo.write` stays a plain, unscoped repo (below) because
// `audit_events.org_id` is NULLABLE — system / no-local-actor events
// (signup pre-org, `logout` for an unprovisioned user,
// `recordCreateOrgFailure` with no org yet) legitimately write a NULL
// org, and a `ScopedRepo` write would refuse that (or worse, silently
// force a bound org onto a row that has none). `ScopedAuditReadRepo`
// (below `AuditRepo`) is the scoped read counterpart FR7 asks for — an
// org's audit VIEW is always "this org's rows", so the read routes
// through the factory while the writer does not.

import { and, desc, eq, lt, or } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  AuditEvent,
  AuditEventType,
  AuditOutcome,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { ScopedRepo } from "./scopedRepoBase";

const { auditEvents } = schema;

export interface RecordAuditEventInput {
  eventType: AuditEventType;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  targetUserId?: string | null;
  orgId?: string | null;
  sourceIp: string;
  userAgent: string;
  metadata?: Record<string, unknown>;
}

export interface ListByOrgOptions {
  /** Page size. Default 50. Hard cap 200 to keep p95 latency bounded. */
  limit?: number;
  /**
   * Keyset cursor: return rows strictly older than this `occurredAt`.
   * Pair with `limit` to walk pages in stable order — id is included
   * as a tiebreaker because two events can share a millisecond.
   */
  before?: { occurredAt: Date; id: string };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class AuditRepo {
  private readonly db: DbOrTx;
  constructor(db: DbOrTx) {
    this.db = db;
  }

  withTx(tx: Tx): AuditRepo {
    return new AuditRepo(tx);
  }

  /**
   * Append-only writer. The application layer (T-013
   * `recordAuditEvent`) is the single canonical caller — handlers
   * never write directly. NFR8 forbidden fields (passwords, MFA
   * codes, session tokens, ...) are rejected at the application
   * layer, not here, so this repo can stay metadata-agnostic.
   *
   * Deliberately NOT a `ScopedRepo` (see file header): `org_id` is
   * nullable here and several legitimate callers (pre-org signup,
   * unprovisioned-user logout, `recordCreateOrgFailure`) write a NULL
   * org. A bound-org write stamp would either reject those or corrupt
   * them with a bogus org — this repo stays unscoped and trusts the
   * caller's explicit (possibly-null) `orgId`.
   */
  async write(input: RecordAuditEventInput): Promise<AuditEvent> {
    const [row] = await this.db
      .insert(auditEvents)
      .values({
        eventType: input.eventType,
        outcome: input.outcome,
        actorUserId: input.actorUserId ?? null,
        targetUserId: input.targetUserId ?? null,
        orgId: input.orgId ?? null,
        sourceIp: input.sourceIp,
        userAgent: input.userAgent,
        metadata: input.metadata ?? {},
      })
      .returning();
    return row as AuditEvent;
  }
}

/**
 * Scoped read-side counterpart to `AuditRepo` (T-004 backfill, FR7).
 * Routes `audit_events` reads through `ScopedRepo` so an org's audit
 * view is always org-scoped — the `WHERE org_id = $A` predicate
 * correctly EXCLUDES the NULL-org system rows the writer above
 * produces (see `tenancy.ts`'s note on `audit_events`); those are
 * visible only under `systemScope`. This is the class `scopedRepo()`
 * exports as `auditReads`; `AuditRepo` itself is never exported from
 * the factory because its writer must stay reachable for null-org
 * writes.
 */
export class ScopedAuditReadRepo extends ScopedRepo {
  withTx(tx: Tx): ScopedAuditReadRepo {
    return new ScopedAuditReadRepo(tx, this.orgId);
  }

  /**
   * Recent-events-by-org listing, scoped to the bound org. Keyset-
   * paginated by `(occurredAt desc, id desc)` — the existing
   * `(org_id, occurred_at desc)` btree (T-003) covers the predicate
   * ordering. Defaulted limit, hard cap; callers control page size
   * but can't ask for the world.
   *
   * Cursor predicate is the composite
   * `(occurredAt, id) < (cursor.occurredAt, cursor.id)` — encoded
   * here as `occurredAt < cursor.occurredAt OR (occurredAt =
   * cursor.occurredAt AND id < cursor.id)`. The id tiebreaker is
   * load-bearing: two events written within the same millisecond
   * (Postgres `now()` is microsecond-resolution but JS `Date` isn't)
   * would otherwise be silently dropped between pages on the
   * cursor-row's timestamp.
   */
  async list(options: ListByOrgOptions = {}): Promise<AuditEvent[]> {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const cursorPredicate = options.before
      ? or(
          lt(auditEvents.occurredAt, options.before.occurredAt),
          and(
            eq(auditEvents.occurredAt, options.before.occurredAt),
            lt(auditEvents.id, options.before.id),
          ),
        )
      : undefined;

    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(this.scoped(auditEvents.orgId, cursorPredicate))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit);
    return rows as AuditEvent[];
  }
}
