// Drizzle-backed repository for the `audit_events` aggregate.
//
// Slice 1 / T-007. Append-only by convention at v0.1; see design.md
// §Data model NFR10 — no `update` or `delete` methods are exposed,
// and SOC 2 entry will tighten this with a Postgres trigger. Used by
// every application-layer task that records auditable activity
// (T-008 through T-013, T-016, T-019).
//
// Read surface is intentionally minimal — the rich filter / pagination
// query that the admin dashboard wants lands in slice 7 once the BFF
// layer is designed. v0.1 needs only a recent-events-by-org listing.

import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  AuditEvent,
  AuditEventType,
  AuditOutcome,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

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
  constructor(private readonly db: Db) {}

  /**
   * Append-only writer. The application layer (T-013
   * `recordAuditEvent`) is the single canonical caller — handlers
   * never write directly. NFR8 forbidden fields (passwords, MFA
   * codes, session tokens, ...) are rejected at the application
   * layer, not here, so this repo can stay metadata-agnostic.
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

  /**
   * Recent-events-by-org listing. Keyset-paginated by `(occurredAt
   * desc, id desc)` — the existing `(org_id, occurred_at desc)` btree
   * (T-003) covers the predicate ordering. Defaulted limit, hard cap;
   * callers control page size but can't ask for the world.
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
  async listByOrg(
    orgId: string,
    options: ListByOrgOptions = {},
  ): Promise<AuditEvent[]> {
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

    const where = cursorPredicate
      ? and(eq(auditEvents.orgId, orgId), cursorPredicate)
      : eq(auditEvents.orgId, orgId);

    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit);
    return rows as AuditEvent[];
  }
}
