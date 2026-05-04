// Application-layer GDPR hard-delete.
//
// Slice 1 / T-019. Implements NFR9: support hard-delete of a single
// user without orphaning org data or audit continuity.
//
// Triggered by the `user.deleted` webhook from WorkOS. The
// scrub-and-tombstone is one DB write — `userRepo.scrubPii` does
// both the PII null-out and the `lifecycle_state = 'deleted'` flip
// in a single UPDATE — so no `db.transaction` wrapper is needed
// here. (The repo's partial unique on `users(email)` excludes
// deleted rows, so a fresh signup with the same address won't
// collide with the tombstone.)
//
// Audit continuity (NFR9): `audit_events.target_user_id` references
// the local UUID, which `scrubPii` deliberately preserves. The
// `workos_user_id` column is also preserved as a tombstone so a
// future replay of a webhook for the same WorkOS id resolves to
// the same row rather than fanning out.
//
// Idempotency: webhook redelivery for an already-scrubbed user is
// a no-op (we detect `lifecycleState === "deleted"` and audit a
// failure with `reason: "already_deleted"` so the dedup is
// observable). Unmirrored-user redelivery returns `{ user: null }`
// the same way the other webhook handlers do.

import type { AuditRepo } from "../infrastructure/db/auditRepo";
import type { UserRepo } from "../infrastructure/db/userRepo";
import type { User } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { type AuditContext, safeAudit } from "./_audit-context";

export interface HandleUserDeletedInput {
  /** WorkOS user id from the webhook payload. */
  workosUserId: string;
  audit: AuditContext;
}

export interface HandleUserDeletedDeps {
  userRepo: UserRepo;
  auditRepo: AuditRepo;
}

export interface HandleUserDeletedResult {
  /**
   * Null when the WorkOS user wasn't mirrored locally (webhook for
   * a user our DB never saw). For both the freshly-scrubbed and
   * already-deleted paths this returns the tombstone row so an
   * operator can correlate.
   */
  user: User | null;
}

export async function handleUserDeleted(
  input: HandleUserDeletedInput,
  deps: HandleUserDeletedDeps,
): Promise<HandleUserDeletedResult> {
  const user = await deps.userRepo.findByWorkosUserId(input.workosUserId);
  if (!user) {
    await safeAudit(deps, {
      eventType: "user_deleted",
      outcome: "failure",
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        reason: "user_not_found",
        workosUserId: input.workosUserId,
      },
    });
    return { user: null };
  }

  if (user.lifecycleState === "deleted") {
    // Idempotent no-op for webhook redelivery. We surface the
    // `already_deleted` reason in metadata so an operator looking
    // at the audit trail can distinguish a real first-time delete
    // from a retry.
    await safeAudit(deps, {
      eventType: "user_deleted",
      outcome: "failure",
      targetUserId: user.id,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        reason: "already_deleted",
        workosUserId: input.workosUserId,
      },
    });
    return { user };
  }

  const scrubbed = await deps.userRepo.scrubPii(user.id);

  // `targetUserId` is the local UUID — preserved by `scrubPii`,
  // load-bearing for the audit-join continuity requirement in NFR9.
  // The audit metadata deliberately omits email + fullName —
  // re-emitting them here would defeat the scrub.
  await safeAudit(deps, {
    eventType: "user_deleted",
    outcome: "success",
    targetUserId: scrubbed.id,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      workosUserId: input.workosUserId,
    },
  });

  return { user: scrubbed };
}
