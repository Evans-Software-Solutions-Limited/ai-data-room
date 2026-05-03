// Application-layer password-reset flow.
//
// Slice 1 / T-011. Two functions, parallel in shape to suspension
// (T-012):
//
//   - `requestPasswordReset` — user-initiated. Delegates to WorkOS's
//     password-reset email flow (FR19). Always returns
//     `{ acknowledged: true }`, even when the email is unknown:
//     never reveal account existence to the caller (NFR8 spirit /
//     enumeration defence). Anomalous reset volume is still
//     investigable through `password_reset_requested` failure audits.
//
//   - `handlePasswordResetCompleted` — webhook-driven. Per FR20,
//     every active WorkOS session for the affected user is revoked
//     so the new password takes effect immediately and a stolen
//     pre-reset session can't outlive the reset. Reuses the
//     `listSessions` → revoke fan-out from suspension.
//
// Idempotency: the completion handler must be safe under webhook
// redelivery (WorkOS delivers at-least-once). Missing-user returns
// null rather than throwing; already-revoked sessions are filtered
// out by `status === "active"` so a redelivery becomes a no-op
// fan-out. The webhook routing layer is responsible for the actual
// at-most-once dedup; this file trusts that and stays simple.
//
// Authorization belongs at the handler layer. Application functions
// enforce data invariants only.

import type { WorkOSClient } from "../infrastructure/workos/client";
import type { AuditRepo } from "../infrastructure/db/auditRepo";
import type { UserRepo } from "../infrastructure/db/userRepo";
import type { User } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { type AuditContext, safeAudit } from "./_audit-context";

/**
 * Handler called us with an empty / missing email — programming error,
 * not a user error. Distinct from unknown-email, which is silently
 * absorbed into the success-shaped response.
 */
export class PasswordResetRequestError extends Error {
  readonly reason = "invalid_email" as const;
  constructor() {
    super("invalid_email");
    this.name = "PasswordResetRequestError";
  }
}

/**
 * WorkOS revoke threw for at least one active session during the
 * completion handler. Re-thrown so the webhook handler can return
 * non-2xx and let WorkOS retry.
 */
export class PasswordResetCompletionError extends Error {
  readonly reason = "revoke_failed" as const;
  constructor() {
    super("revoke_failed");
    this.name = "PasswordResetCompletionError";
  }
}

// ---------------------------------------------------------------------------
// requestPasswordReset
// ---------------------------------------------------------------------------

export interface RequestPasswordResetInput {
  email: string;
  audit: AuditContext;
}

export interface RequestPasswordResetDeps {
  workos: WorkOSClient;
  auditRepo: AuditRepo;
}

/**
 * Trigger a password-reset email via WorkOS. Always returns
 * `{ acknowledged: true }` regardless of whether the email is
 * registered — the response shape, status code, and timing must not
 * differ between known and unknown emails.
 *
 * We deliberately skip a local user lookup before delegating: a
 * `userRepo.findByEmail` here would itself leak existence via timing
 * (DB hit vs. miss), and would also block the request on a DB call
 * that has no functional value (WorkOS holds the source of truth for
 * which emails exist).
 */
export async function requestPasswordReset(
  input: RequestPasswordResetInput,
  deps: RequestPasswordResetDeps,
): Promise<{ acknowledged: true }> {
  const email = input.email?.trim();
  if (!email) {
    throw new PasswordResetRequestError();
  }

  try {
    await deps.workos.sendPasswordResetEmail({ email });
    await safeAudit(deps, {
      eventType: "password_reset_requested",
      outcome: "success",
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: { email },
    });
  } catch {
    // Swallow the WorkOS error: propagating it would leak
    // registration state via response shape or timing. The audit
    // failure is enough for ops visibility (alert on rate, not on
    // individual events).
    await safeAudit(deps, {
      eventType: "password_reset_requested",
      outcome: "failure",
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: { email, reason: "delegate_error" },
    });
  }

  return { acknowledged: true };
}

// ---------------------------------------------------------------------------
// handlePasswordResetCompleted
// ---------------------------------------------------------------------------

export interface HandlePasswordResetCompletedInput {
  /** WorkOS user id from the `password_reset.succeeded` payload. */
  workosUserId: string;
  audit: AuditContext;
}

export interface HandlePasswordResetCompletedDeps {
  workos: WorkOSClient;
  userRepo: UserRepo;
  auditRepo: AuditRepo;
}

export interface HandlePasswordResetCompletedResult {
  revokedSessions: number;
  /** `null` if we don't mirror this WorkOS user — see file header. */
  user: User | null;
}

/**
 * React to a verified `password_reset.succeeded` webhook. Revokes
 * every active WorkOS session for the user so the new password is
 * immediately effective.
 */
export async function handlePasswordResetCompleted(
  input: HandlePasswordResetCompletedInput,
  deps: HandlePasswordResetCompletedDeps,
): Promise<HandlePasswordResetCompletedResult> {
  const user = await deps.userRepo.findByWorkosUserId(input.workosUserId);
  if (!user) {
    // Audit + return null rather than throw: re-throwing would force
    // WorkOS into a permanent retry loop for an event we'll never
    // act on (we don't mirror this user locally).
    await safeAudit(deps, {
      eventType: "password_reset_completed",
      outcome: "failure",
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        reason: "user_not_found",
        workosUserId: input.workosUserId,
      },
    });
    return { revokedSessions: 0, user: null };
  }

  const sessions = await deps.workos.listSessions(user.workosUserId);
  const activeSessions = sessions.filter((s) => s.status === "active");

  // `allSettled` (vs `all`) so a single failed revoke doesn't hide
  // how many sessions actually got terminated. FR20 requires every
  // session revoked, so any rejection is still a hard failure — but
  // the audit row carries the per-attempt breakdown for forensics.
  const results = await Promise.all(
    activeSessions.map(async (s) => {
      try {
        await deps.workos.revokeSession({ sessionId: s.id });
        return true;
      } catch {
        return false;
      }
    }),
  );
  const succeeded = results.filter(Boolean).length;
  const failed = results.length - succeeded;

  if (failed > 0) {
    await safeAudit(deps, {
      eventType: "password_reset_completed",
      outcome: "failure",
      targetUserId: user.id,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        reason: "revoke_failed",
        attempted: results.length,
        succeeded,
        failed,
      },
    });
    throw new PasswordResetCompletionError();
  }

  await safeAudit(deps, {
    eventType: "password_reset_completed",
    outcome: "success",
    targetUserId: user.id,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { revokedSessions: succeeded },
  });

  return { revokedSessions: succeeded, user };
}
