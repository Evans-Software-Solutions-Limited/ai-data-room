// Application-layer audit writer.
//
// Slice 1 / T-013. Every other application-layer task in this slice
// (T-008 signup/login, T-009 invitations, T-010 MFA, T-011 password
// reset, T-012 suspension, T-016 webhook routing, T-019 GDPR delete)
// records audit events through this single function — handlers and
// other application code MUST NOT call `AuditRepo.write` directly.
// That guarantees:
//
//   1. Every event is validated against the canonical shape from
//      design.md §Audit event canonical shape (zod parse — throws on
//      drift, surfacing the bug at the right layer).
//   2. NFR8-forbidden material (passwords, MFA codes, recovery
//      codes, session tokens, reset tokens, invite tokens) is
//      stripped from metadata as defense-in-depth, even if a
//      callsite forgets and includes one.
//
// T-013 ships the canonical writer. The slice-level question of
// how many of the 21 FR24 event types currently have a production
// callsite lives in the T-022 sign-off matrix's "FR24 event-type
// coverage" sub-section (`docs/slices/auth-and-orgs.md`) — that's
// the source of truth for callsite exhaustiveness. Slice 1 ships
// 11 of 21 (9 production-reachable, 2 awaiting HANDOFF #5); the
// remaining 10 are owned per-event by future slices + the WorkOS
// event-name investigation.

import { z } from "zod";

import {
  AuditEventSchema,
  type AuditEvent,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import type { AuditRepo } from "../infrastructure/db/auditRepo";

/**
 * Forbidden-key regex covering the NFR8 list:
 * `passwords | MFA codes | recovery codes | session tokens |
 *  reset tokens | invite tokens`.
 *
 * Case-insensitive and snake/camel-agnostic — `recoveryCode`,
 * `recovery_code`, `RECOVERY_CODE` all match. The pattern is
 * deliberately broader than the literal NFR8 names so a callsite
 * accidentally adding `passwordHash` or `magicAuthToken` is also
 * caught. False positives are acceptable because the value of a
 * benign key matching the pattern (say `tokenCount`) is unlikely
 * to break a downstream consumer; a leak the other way would be
 * a security failure.
 */
const FORBIDDEN_KEY_PATTERN = /password|token|secret|recovery_?code|mfa_?code/i;

/**
 * Schema for what `recordAuditEvent` accepts at the application
 * boundary. Derived from the canonical `AuditEventSchema` (T-004) so
 * any future field addition in the design.md spec automatically
 * threads through here — no schema-drift risk.
 *
 * Two shape adjustments vs. the canonical:
 *   - `id` and `occurredAt` are dropped (DB-stamped via
 *     `gen_random_uuid()` / `default now()`).
 *   - `actorUserId` / `targetUserId` / `orgId` / `metadata` are made
 *     `.optional()` on top of their canonical `.nullable()` so a
 *     caller can omit them entirely (the most common case for
 *     pre-auth signup events) instead of having to pass `null`.
 */
const RecordAuditEventInputSchema = AuditEventSchema.omit({
  id: true,
  occurredAt: true,
  actorUserId: true,
  targetUserId: true,
  orgId: true,
  metadata: true,
}).extend({
  actorUserId: z.string().uuid().nullable().optional(),
  targetUserId: z.string().uuid().nullable().optional(),
  orgId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RecordAuditEventInput = z.input<typeof RecordAuditEventInputSchema>;

export interface RecordAuditEventDeps {
  auditRepo: AuditRepo;
}

/**
 * Persist one audit event. The single canonical entry point for
 * audit writes from the application layer.
 */
export async function recordAuditEvent(
  input: RecordAuditEventInput,
  deps: RecordAuditEventDeps,
): Promise<AuditEvent> {
  const validated = RecordAuditEventInputSchema.parse(input);
  const sanitisedMetadata = stripForbidden(validated.metadata ?? {});
  return deps.auditRepo.write({
    eventType: validated.eventType,
    outcome: validated.outcome,
    actorUserId: validated.actorUserId ?? null,
    targetUserId: validated.targetUserId ?? null,
    orgId: validated.orgId ?? null,
    sourceIp: validated.sourceIp,
    userAgent: validated.userAgent,
    metadata: sanitisedMetadata,
  });
}

/**
 * Drop any key matching `FORBIDDEN_KEY_PATTERN`. Case-insensitive,
 * snake/camel agnostic. The strip itself is silent — emitting a log
 * about "we stripped a forbidden field" would be its own leak vector
 * and would also lower trust in the audit pipeline (consumers
 * shouldn't see "stripped" placeholders in metadata). The
 * application layer is responsible for not putting these in
 * metadata in the first place; this is a safety net.
 */
function stripForbidden(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) continue;
    result[key] = value;
  }
  return result;
}
