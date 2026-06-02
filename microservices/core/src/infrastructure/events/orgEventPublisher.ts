// Org domain-event publisher port + its logging stub.
//
// Slice 17 / T-002. `createOrg` emits `org.created` on commit so
// `room-and-folders` can provision the canonical room (FR3). The
// application depends on this PORT (the `OrgEventPublisher` interface);
// the concrete transport is injected by `deps.ts`.
//
// As of T-005 the wired transport is EventBridge — see
// `eventBridgeOrgEventPublisher.ts` (an SST bus in `infra/events.ts` +
// the `PutEvents` adapter). The logging stub below stays as the
// no-AWS fallback for unit tests and any local context without a
// deployed bus; both implement the same interface, so swapping is a
// one-line change in `deps.ts` with no change to `createOrg` or the
// handler.

import { ORG_CREATED_DETAIL_TYPE } from "@ai-data-room/api-utils/schemas/org";
import type { OrgCreatedEvent } from "@ai-data-room/api-utils/schemas/org";

import { logger } from "../logging/logger";
import { emitCount } from "../observability/metrics";

export interface OrgEventPublisher {
  /**
   * Publish `org.created`. Implementations MUST be resilient — the
   * org already exists by the time this runs (post-commit), so a
   * publish failure must not throw back into the request; it is
   * logged + metered for reconciliation instead. The room-provisioning
   * subscriber is idempotent (keyed on `org_id`), so a redelivery is
   * safe (NFR2).
   */
  emitOrgCreated(event: OrgCreatedEvent): Promise<void>;
}

/**
 * v0.1 stub — logs the event and increments a metric so the producer
 * side is observable before the EventBridge transport lands (T-005).
 * Never throws.
 */
export function createLoggingOrgEventPublisher(): OrgEventPublisher {
  return {
    async emitOrgCreated(event: OrgCreatedEvent): Promise<void> {
      logger.info("org.created.emit_stub", {
        detailType: ORG_CREATED_DETAIL_TYPE,
        orgId: event.orgId,
        workosOrgId: event.workosOrgId,
        ownerUserId: event.ownerUserId,
      });
      emitCount("org.provision.room_handoff_stub");
    },
  };
}
