// Internal helpers shared across the application-layer auth flows.
// Leading underscore signals "scoped to application/, not exported
// from the package barrel". Imported by every flow that records
// audit events with per-request context (signup, login, invitations,
// mfa, password-reset, suspension, deletion).

import { serializeError } from "@ai-data-room/api-utils/logging";

import type { AuditRepo } from "../infrastructure/db/auditRepo";
import type { SystemAuditTag } from "../infrastructure/db/scoped";
import { logger } from "../infrastructure/logging/logger";
import { emitCount } from "../infrastructure/observability/metrics";

import { recordAuditEvent } from "./audit";

/**
 * Per-request context every audit-emitting flow needs. Captured at
 * the handler layer (T-014) from API Gateway and threaded through to
 * the application function.
 */
export interface AuditContext {
  sourceIp: string;
  userAgent: string;
}

// A system-initiated audit event has no external client. `AuditEventSchema`
// still requires a valid IP (`z.string().ip()`), so we stamp the IPv4
// loopback — semantically "originated locally, inside our own system", never
// a real client address. Paired with `userAgent: "system"` and a null actor.
const SYSTEM_SOURCE_IP = "127.0.0.1";
const SYSTEM_USER_AGENT = "system";

/**
 * The audit fields a system operation (tenant-isolation T-003 `systemScope`)
 * records: no request context, no user actor, and a metadata tag naming the
 * job so a `systemScope` write is always attributable and never looks like a
 * user's. Spread this into a `recordAuditEvent` / `safeAudit` call alongside
 * the event type, outcome, and `orgId` the system scope names.
 */
export interface SystemAuditContext extends AuditContext {
  actorUserId: null;
  metadata: { actor: "system"; reason: string };
}

/** Expand a `systemScope(...).audit` tag into the audit fields above (FR2). */
export function systemAuditContext(tag: SystemAuditTag): SystemAuditContext {
  return {
    sourceIp: SYSTEM_SOURCE_IP,
    userAgent: SYSTEM_USER_AGENT,
    actorUserId: null,
    metadata: { actor: tag.actor, reason: tag.reason },
  };
}

/**
 * Audit emission that swallows `recordAuditEvent` errors.
 *
 * We don't want a failed audit write to mask the original outcome —
 * a 500 on the audit table would otherwise convert a successful
 * signup / login / suspension into a fake failure (or mask a real
 * failure with a different one). Production observability via the
 * `auth.audit.write_failure` metric (T-018) catches the dropped
 * event; the right level to react to it is alerting, not the
 * application's happy path.
 */
export async function safeAudit(
  deps: { auditRepo: AuditRepo },
  event: Parameters<typeof recordAuditEvent>[0],
): Promise<void> {
  try {
    await recordAuditEvent(event, { auditRepo: deps.auditRepo });
  } catch (err) {
    // Swallowed so the original outcome isn't masked, but the
    // structured log + metric guarantee an operator can react. The
    // metric drives the > 0 alarm in `infra/observability.ts`.
    emitCount("auth.audit.write_failure");
    logger.error("audit.write_failure", {
      eventType: event.eventType,
      outcome: event.outcome,
      error: serializeError(err),
    });
  }
}
