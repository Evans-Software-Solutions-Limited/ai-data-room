// Integration tests for `WebhookDeliveryRepo`.
//
// The dedup ledger is the load-bearing piece of T-016's
// at-most-once contract; these tests prove the contract against a
// real Postgres so the unit-level webhook handler tests can mock
// the repo with confidence.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  applyMigrations,
  destroyTestPool,
  getTestDb,
  truncateAllTables,
} from "@ai-data-room/db/test/integration/setup";

import { WebhookDeliveryRepo } from "../../../src/infrastructure/db/webhookDeliveryRepo";

describe("WebhookDeliveryRepo (integration)", () => {
  let repo: WebhookDeliveryRepo;

  beforeAll(async () => {
    await applyMigrations();
    repo = new WebhookDeliveryRepo(getTestDb());
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  it("markDelivered() returns firstDelivery=true on a fresh event id", async () => {
    const result = await repo.markDelivered(
      "event_01TEST_FRESH",
      "user.deleted",
    );
    expect(result.firstDelivery).toBe(true);
    expect(result.delivery.eventId).toBe("event_01TEST_FRESH");
    expect(result.delivery.eventType).toBe("user.deleted");
    expect(result.delivery.receivedAt).toBeInstanceOf(Date);
  });

  it("markDelivered() returns firstDelivery=false on redelivery and preserves the original receivedAt", async () => {
    // Defends the at-most-once contract: a second call with the
    // same event id returns the original delivery's metadata, not
    // a fresh row. Without this, a redelivery's audit row would
    // overwrite the operator's view of when the event first
    // arrived.
    const first = await repo.markDelivered(
      "event_01TEST_REPLAY",
      "user.deleted",
    );
    expect(first.firstDelivery).toBe(true);
    const firstReceivedAt = first.delivery.receivedAt;

    // Sleep one ms so a (hypothetical) replacement row would have
    // a strictly later timestamp than the original — makes the
    // assertion bite if a future change accidentally upserts.
    await new Promise((r) => setTimeout(r, 2));

    const second = await repo.markDelivered(
      "event_01TEST_REPLAY",
      "user.deleted",
    );
    expect(second.firstDelivery).toBe(false);
    expect(second.delivery.receivedAt.toISOString()).toBe(
      firstReceivedAt.toISOString(),
    );
    // eventType is also preserved from the original delivery.
    expect(second.delivery.eventType).toBe("user.deleted");
  });

  it("a third+ delivery is also a no-op — replay 3× yields one row", async () => {
    // The literal T-016 DoD: "Replaying a webhook 3× yields
    // exactly one audit row and one state change". The audit + state
    // halves are the application handler's job; this test pins the
    // dedup half.
    await repo.markDelivered("event_01TEST_3X", "invitation.accepted");
    await repo.markDelivered("event_01TEST_3X", "invitation.accepted");
    const third = await repo.markDelivered(
      "event_01TEST_3X",
      "invitation.accepted",
    );
    expect(third.firstDelivery).toBe(false);
  });

  it("distinct event ids do NOT collide", async () => {
    const a = await repo.markDelivered("event_01A", "user.deleted");
    const b = await repo.markDelivered("event_01B", "user.deleted");
    expect(a.firstDelivery).toBe(true);
    expect(b.firstDelivery).toBe(true);
  });
});
