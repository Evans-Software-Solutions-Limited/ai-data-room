// Drizzle-backed repository for the `webhook_deliveries` aggregate.
//
// Slice 1 / T-016. The dedup ledger that closes the at-most-once
// idempotency contract for the WorkOS webhook handler. Every
// inbound event passes through `markDelivered` first; the routing
// layer fans out to application handlers only when the row was
// actually inserted (i.e. `firstDelivery: true`).
//
// The application handlers themselves are independently idempotent
// (already-deleted no-ops, already-accepted no-ops, etc.), so the
// dedup is belt-and-braces from a state perspective. The reason
// it's load-bearing is the audit trail: redelivered events would
// otherwise emit a duplicate `outcome: "failure"` row with reason
// `already_*` for every retry. The spec wants exactly one audit
// row and one state change per event.

import { eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";

import { firstOrNull } from "./_helpers";

const { webhookDeliveries } = schema;

export interface WebhookDelivery {
  eventId: string;
  eventType: string;
  receivedAt: Date;
}

export interface MarkDeliveredResult {
  /**
   * `true` when the routing layer is seeing this WorkOS event id
   * for the first time. `false` on redelivery — the caller should
   * ack the webhook with 200 and skip routing to avoid duplicate
   * audit rows.
   */
  firstDelivery: boolean;
  delivery: WebhookDelivery;
}

export class WebhookDeliveryRepo {
  private readonly db: DbOrTx;
  constructor(db: DbOrTx) {
    this.db = db;
  }

  withTx(tx: Tx): WebhookDeliveryRepo {
    return new WebhookDeliveryRepo(tx);
  }

  /**
   * Insert-or-detect-conflict. Postgres `ON CONFLICT DO NOTHING`
   * makes the first-delivery path a single round-trip: a fresh
   * event yields one returned row. Redelivery yields zero rows from
   * the INSERT, in which case we follow up with a SELECT so the
   * caller still gets the original delivery's metadata for the
   * access log.
   */
  async markDelivered(
    eventId: string,
    eventType: string,
  ): Promise<MarkDeliveredResult> {
    const inserted = await this.db
      .insert(webhookDeliveries)
      .values({ eventId, eventType })
      .onConflictDoNothing()
      .returning();
    const insertedRow = firstOrNull(inserted as WebhookDelivery[]);
    if (insertedRow) {
      return { firstDelivery: true, delivery: insertedRow };
    }

    const existing = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.eventId, eventId));
    const existingRow = firstOrNull(existing as WebhookDelivery[]);
    if (!existingRow) {
      // Insert skipped (ON CONFLICT) but the row is gone — only
      // possible if a concurrent transaction inserted then aborted,
      // or a future task adds a DELETE path that runs between our
      // two statements. v0.1 has neither, so this is a hard data-
      // integrity violation rather than something to silently paper
      // over (a fall-through "treat as fresh" would let routing
      // proceed and break the at-most-once guarantee).
      throw new Error(
        `webhook_deliveries: insert skipped but row missing for ${eventId}`,
      );
    }
    return { firstDelivery: false, delivery: existingRow };
  }
}
