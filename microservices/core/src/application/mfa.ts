// Application-layer MFA webhook handlers.
//
// Slice 1 / T-010, scope trimmed by ADR-003. AuthKit owns the full
// recovery-codes UX (view + download at enrolment); we never see
// plaintext codes and there is no application-layer download method.
// Our job is two webhook reactions:
//
//   - `handleMfaEnrolled` — `authentication.mfa_enrolled` webhook
//     fires when a user finishes MFA enrolment in AuthKit. We mirror
//     `users.mfa_enrolled_at` (load-bearing for the login-time MFA
//     gate in `login.ts`) and audit `mfa_enrolled`.
//
//   - `handleRecoveryCodeUsed` — `authentication.recovery_code_used`
//     webhook fires when a user authenticates via a recovery code.
//     We audit only — the per-code identity, hash, and use-count all
//     live in WorkOS. Audit metadata MUST NOT include any token
//     material (NFR8 + ADR-003 follow-up #4).
//
// Both handlers are idempotent under webhook redelivery: missing
// users return null rather than throw (a throw would force WorkOS
// into a permanent retry loop for an event we'll never act on);
// re-mirroring the same `mfa_enrolled_at` is a no-op write. The
// webhook routing layer owns the actual at-most-once dedup; this
// file trusts that and stays simple.
//
// Authorization belongs at the handler layer. Application functions
// enforce data invariants only.

import type { AuditRepo } from "../infrastructure/db/auditRepo";
import type { UserRepo } from "../infrastructure/db/userRepo";
import type { User } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { type AuditContext, safeAudit } from "./_audit-context";

// ---------------------------------------------------------------------------
// handleMfaEnrolled
// ---------------------------------------------------------------------------

export interface HandleMfaEnrolledInput {
  workosUserId: string;
  /** Event timestamp from the webhook payload — preferred over
   * `new Date()` so re-deliveries don't drift the mirrored value
   * away from when enrolment actually happened. */
  enrolledAt: Date;
  audit: AuditContext;
}

export interface HandleMfaEnrolledDeps {
  userRepo: UserRepo;
  auditRepo: AuditRepo;
}

export interface HandleMfaEnrolledResult {
  /** `null` if we don't mirror this WorkOS user — webhook acks
   * regardless so WorkOS stops retrying. */
  user: User | null;
}

export async function handleMfaEnrolled(
  input: HandleMfaEnrolledInput,
  deps: HandleMfaEnrolledDeps,
): Promise<HandleMfaEnrolledResult> {
  const user = await deps.userRepo.findByWorkosUserId(input.workosUserId);
  if (!user) {
    await safeAudit(deps, {
      eventType: "mfa_enrolled",
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

  const updated = await deps.userRepo.setMfaEnrolledAt(
    user.id,
    input.enrolledAt,
  );

  await safeAudit(deps, {
    eventType: "mfa_enrolled",
    outcome: "success",
    targetUserId: updated.id,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { enrolledAt: input.enrolledAt.toISOString() },
  });

  return { user: updated };
}

// ---------------------------------------------------------------------------
// handleRecoveryCodeUsed
// ---------------------------------------------------------------------------

export interface HandleRecoveryCodeUsedInput {
  workosUserId: string;
  audit: AuditContext;
}

export interface HandleRecoveryCodeUsedDeps {
  /** Only `findByWorkosUserId` is used — narrower than
   * `HandleMfaEnrolledDeps` because this handler never mutates. */
  userRepo: Pick<UserRepo, "findByWorkosUserId">;
  auditRepo: AuditRepo;
}

export interface HandleRecoveryCodeUsedResult {
  user: User | null;
}

export async function handleRecoveryCodeUsed(
  input: HandleRecoveryCodeUsedInput,
  deps: HandleRecoveryCodeUsedDeps,
): Promise<HandleRecoveryCodeUsedResult> {
  const user = await deps.userRepo.findByWorkosUserId(input.workosUserId);
  if (!user) {
    await safeAudit(deps, {
      eventType: "recovery_code_used",
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

  // Empty metadata by design: the per-code identity lives in WorkOS
  // and we deliberately don't mirror it (ADR-003 follow-up #4).
  await safeAudit(deps, {
    eventType: "recovery_code_used",
    outcome: "success",
    targetUserId: user.id,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {},
  });

  return { user };
}
