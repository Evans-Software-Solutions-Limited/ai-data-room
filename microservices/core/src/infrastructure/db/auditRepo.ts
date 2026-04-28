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

import { and, desc, eq, lt } from "drizzle-orm";
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
   */
  async listByOrg(
    orgId: string,
    options: ListByOrgOptions = {},
  ): Promise<AuditEvent[]> {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const predicates = [eq(auditEvents.orgId, orgId)];
    if (options.before) {
      predicates.push(lt(auditEvents.occurredAt, options.before.occurredAt));
    }

    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(and(...predicates))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit);
    return rows as AuditEvent[];
  }
}
