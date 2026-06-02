// EventBridge transport for the `org.created` domain event — slice 17 /
// org-provisioning T-005.
//
// This is the production `OrgEventPublisher` (see `orgEventPublisher.ts`
// for the port + the T-002 logging stub it replaces). `createOrg` emits
// `org.created` post-commit so `room-and-folders` can provision the
// canonical room idempotently (FR3); this adapter puts that event onto
// the EventBus declared in `infra/events.ts`.
//
// Contract (canonical copy in `docs/slices/org-provisioning.md`):
//   - **Source:**       `ai-data-room.core`            (this service)
//   - **Detail-type:**  `org.created`                  (ORG_CREATED_DETAIL_TYPE)
//   - **Detail:**       `{ orgId, workosOrgId, ownerUserId }` (OrgCreatedEvent)
//   The room-provisioning subscriber matches on the detail-type and keys
//   its idempotency on `orgId` — a redelivery (EventBridge is at-least-
//   once) must NOT create duplicate folders (NFR2). The producer makes no
//   exactly-once guarantee; idempotency is the consumer's contract.
//
// Resilience: the org already exists by the time this runs (post-commit),
// so a publish failure MUST NOT throw back into the request — it's logged
// + metered (`org.provision.room_handoff_failed`) for reconciliation, and
// reconciliation leans on the consumer's idempotency. This mirrors the
// port doc and the stub's "never throws" guarantee. `PutEvents` can also
// fail *per-entry* without rejecting (a non-zero `FailedEntryCount`), so
// we treat that as a failure too rather than reading a 200 as success.

import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";

import { ORG_CREATED_DETAIL_TYPE } from "@ai-data-room/api-utils/schemas/org";
import type { OrgCreatedEvent } from "@ai-data-room/api-utils/schemas/org";
import { serializeError } from "@ai-data-room/api-utils/logging";

import { logger } from "../logging/logger";
import { emitCount } from "../observability/metrics";
import type { OrgEventPublisher } from "./orgEventPublisher";

/** EventBridge `source` for every domain event this service emits. The
 *  EventBus rule that drives room provisioning matches on the detail-type
 *  (`org.created`); `source` is informational/operator-facing. */
export const CORE_EVENT_SOURCE = "ai-data-room.core";

/**
 * The single EventBridge client method this adapter uses, narrowed so a
 * unit test can inject a fake `send` without standing up the AWS SDK.
 */
export interface EventBridgePutEvents {
  send(command: PutEventsCommand): Promise<PutEventsCommandOutput>;
}

export interface EventBridgeOrgEventPublisherConfig {
  /** Target EventBus name — pass `Resource.CoreEventBus.name`. */
  busName: string;
  /** Override the `source` (defaults to `CORE_EVENT_SOURCE`). */
  source?: string;
  /** Override the client (tests). Defaults to a real `EventBridgeClient`
   *  constructed once per publisher and reused across warm invocations. */
  client?: EventBridgePutEvents;
}

/**
 * Production `OrgEventPublisher` backed by EventBridge `PutEvents`. The
 * client is constructed once (warm-Lambda reuse) and closed over; the
 * `busName` comes from the caller (deps.ts reads it from `Resource`), so
 * this module imports neither `sst` nor `Resource` and stays unit-testable.
 */
export function createEventBridgeOrgEventPublisher(
  config: EventBridgeOrgEventPublisherConfig,
): OrgEventPublisher {
  const source = config.source ?? CORE_EVENT_SOURCE;
  const client: EventBridgePutEvents =
    config.client ?? new EventBridgeClient({});

  return {
    async emitOrgCreated(event: OrgCreatedEvent): Promise<void> {
      try {
        const out = await client.send(
          new PutEventsCommand({
            Entries: [
              {
                EventBusName: config.busName,
                Source: source,
                DetailType: ORG_CREATED_DETAIL_TYPE,
                Detail: JSON.stringify(event),
              },
            ],
          }),
        );

        // PutEvents returns 200 even when individual entries are
        // rejected — the per-entry failure shows up as FailedEntryCount.
        if ((out.FailedEntryCount ?? 0) > 0) {
          emitCount("org.provision.room_handoff_failed");
          logger.error("org.created.emit_failed", {
            detailType: ORG_CREATED_DETAIL_TYPE,
            orgId: event.orgId,
            failedEntryCount: out.FailedEntryCount,
            // Per-entry ErrorCode/ErrorMessage for reconciliation.
            entries: out.Entries,
          });
          return;
        }

        emitCount("org.provision.room_handoff_ok");
        logger.info("org.created.emit", {
          detailType: ORG_CREATED_DETAIL_TYPE,
          orgId: event.orgId,
          workosOrgId: event.workosOrgId,
          ownerUserId: event.ownerUserId,
        });
      } catch (err) {
        // Never throw back into the request (port contract). Logged +
        // metered for reconciliation; the consumer's org_id idempotency
        // makes a later replay safe.
        emitCount("org.provision.room_handoff_failed");
        logger.error("org.created.emit_failed", {
          detailType: ORG_CREATED_DETAIL_TYPE,
          orgId: event.orgId,
          error: serializeError(err),
        });
      }
    },
  };
}
