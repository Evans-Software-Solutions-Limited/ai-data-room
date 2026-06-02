// Org domain-event publisher port + its v0.1 stub.
//
// Slice 17 / T-002. `createOrg` emits `org.created` on commit so
// `room-and-folders` can provision the canonical room (FR3). The
// transport is EventBridge, but that infrastructure (an SST bus + the
// PutEvents adapter) lands in T-005 — and T-005 is an infra change that
// needs `sst diff`, so it ships in its own PR.
//
// To keep the create-org path complete and fully unit-testable *now*,
// the application depends on this PORT (the `OrgEventPublisher`
// interface), and T-002 wires the logging stub below. T-005 replaces
// the stub with an EventBridge adapter implementing the same interface —
// no change to `createOrg` or the handler.

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
