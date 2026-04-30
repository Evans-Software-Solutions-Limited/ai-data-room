// Internal helpers shared across the application-layer auth flows.
// Leading underscore signals "scoped to application/, not exported
// from the package barrel". Imported by every flow that records
// audit events with per-request context (signup, login, invitations,
// mfa, password-reset, suspension, deletion).

import type { AuditRepo } from "../infrastructure/db/auditRepo";

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
  } catch {
    /* swallowed — see fn doc. */
  }
}
