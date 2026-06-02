// Unit tests for the EventBridge `org.created` transport (slice 17 /
// T-005). A fake `send` is injected so the SDK never reaches the network;
// we assert the PutEvents contract (bus / source / detail-type / detail)
// and that the port's "never throws + meter the failure" guarantee holds
// on both an SDK rejection and a per-entry (`FailedEntryCount`) failure.

import { afterEach, describe, expect, it, vi } from "vitest";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";

import { ORG_CREATED_DETAIL_TYPE } from "@ai-data-room/api-utils/schemas/org";
import type { OrgCreatedEvent } from "@ai-data-room/api-utils/schemas/org";

import { metrics } from "../../observability/metrics";
import {
  CORE_EVENT_SOURCE,
  createEventBridgeOrgEventPublisher,
  type EventBridgePutEvents,
} from "../eventBridgeOrgEventPublisher";

const BUS = "core-bus-dev";
const EVENT: OrgCreatedEvent = {
  orgId: "22222222-2222-4222-8222-222222222222",
  workosOrgId: "org_workos_new",
  ownerUserId: "11111111-1111-4111-8111-111111111111",
};

/** Metric names passed to `metrics.addMetric` during a run. */
function metricNames(calls: unknown[][]): string[] {
  return calls.map((c) => c[0] as string);
}

describe("createEventBridgeOrgEventPublisher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts a single org.created entry with the documented contract", async () => {
    const addMetric = vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
    const send = vi.fn().mockResolvedValue({ FailedEntryCount: 0 });
    const publisher = createEventBridgeOrgEventPublisher({
      busName: BUS,
      client: { send } as EventBridgePutEvents,
    });

    await publisher.emitOrgCreated(EVENT);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as PutEventsCommand;
    expect(command).toBeInstanceOf(PutEventsCommand);
    const entries = command.input.Entries ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      EventBusName: BUS,
      Source: CORE_EVENT_SOURCE,
      DetailType: ORG_CREATED_DETAIL_TYPE,
    });
    expect(JSON.parse(entries[0]?.Detail ?? "{}")).toEqual(EVENT);
    // Success meters the handoff-ok counter, never the failure one.
    expect(metricNames(addMetric.mock.calls)).toContain(
      "org.provision.room_handoff_ok",
    );
    expect(metricNames(addMetric.mock.calls)).not.toContain(
      "org.provision.room_handoff_failed",
    );
  });

  it("honours a source override", async () => {
    const send = vi.fn().mockResolvedValue({ FailedEntryCount: 0 });
    const publisher = createEventBridgeOrgEventPublisher({
      busName: BUS,
      source: "ai-data-room.test",
      client: { send } as EventBridgePutEvents,
    });

    await publisher.emitOrgCreated(EVENT);

    const command = send.mock.calls[0][0] as PutEventsCommand;
    expect(command.input.Entries?.[0]?.Source).toBe("ai-data-room.test");
  });

  it("meters a failure and does NOT throw when a per-entry put fails", async () => {
    const addMetric = vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
    const send = vi.fn().mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: "InternalFailure", ErrorMessage: "boom" }],
    });
    const publisher = createEventBridgeOrgEventPublisher({
      busName: BUS,
      client: { send } as EventBridgePutEvents,
    });

    // Must resolve (post-commit: a publish failure can't fail the request).
    await expect(publisher.emitOrgCreated(EVENT)).resolves.toBeUndefined();
    expect(metricNames(addMetric.mock.calls)).toContain(
      "org.provision.room_handoff_failed",
    );
    expect(metricNames(addMetric.mock.calls)).not.toContain(
      "org.provision.room_handoff_ok",
    );
  });

  it("meters a failure and does NOT throw when the SDK rejects", async () => {
    const addMetric = vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
    const send = vi.fn().mockRejectedValue(new Error("eventbridge down"));
    const publisher = createEventBridgeOrgEventPublisher({
      busName: BUS,
      client: { send } as EventBridgePutEvents,
    });

    await expect(publisher.emitOrgCreated(EVENT)).resolves.toBeUndefined();
    expect(metricNames(addMetric.mock.calls)).toContain(
      "org.provision.room_handoff_failed",
    );
  });
});
