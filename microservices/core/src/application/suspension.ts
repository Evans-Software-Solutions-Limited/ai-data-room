// Application-layer suspension lifecycle.
//
// Slice 1 / T-012. `suspendUser` and `unsuspendUser` per FR21–FR23
// and US11. Handlers (T-014) wire these to HTTP later. Authorization
// (only owner / admin can suspend) is a handler-layer concern; this
// file enforces the domain invariants:
//
//   - **FR23 self-prevention**: actor cannot suspend themselves.
//   - **FR23 sole-owner protection**: the (single) owner of an org
//     cannot be suspended. Ownership transfer is out-of-scope for
//     slice 1, so the only way to suspend the owner is to first
//     promote a different user to owner — which itself is out of
//     scope.
//   - **FR21(a) lifecycle flip**: `users.lifecycle_state = 'suspended'`.
//   - **FR21(b) session termination**: every active WorkOS session
//     is revoked. We list-then-revoke. Revocations run in parallel
//     because each is independent; we await all of them before
//     proceeding so the function doesn't return while a session is
//     still alive (the spec's timing-test requirement).
//   - **FR21(c) future-login rejection**: handled by `login.ts` —
//     `lifecycleState !== 'active'` rejects the callback.
//   - **FR21(d) audit**: `user_suspended` (success) /
//     `user_unsuspended` (un-suspend) / `user_suspended` with
//     `outcome: 'failure'` for the rejection branches.
//
// Order of operations matters. WorkOS revoke runs BEFORE we flip
// our local lifecycle:
//
//   - If revoke throws, our DB stays consistent (target is still
//     `active`) and the caller sees the failure.
//   - If revoke succeeds but the lifecycle flip throws, we have a
//     short window where the user can't authenticate (sessions
//     gone) but our DB still says `active`. They'll fail login at
//     the WorkOS callback anyway. Better than the opposite — DB
//     says `suspended`, sessions still alive — which would let the
//     user keep using existing sessions until they expire.

import type { WorkOSClient } from "../infrastructure/workos/client";
import type { AuditRepo } from "../infrastructure/db/auditRepo";
import type { MembershipRepo } from "../infrastructure/db/membershipRepo";
import type { UserRepo } from "../infrastructure/db/userRepo";
import type { User } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { emitCount } from "../infrastructure/observability/metrics";
import { type AuditContext, safeAudit } from "./_audit-context";

/** Shared shape for both `suspendUser` and `unsuspendUser`. */
export interface SuspensionInput {
  /** The user-id of the actor performing the (un)suspension. */
  actorId: string;
  /** The user-id of the user being (un)suspended. */
  targetId: string;
  /** The org-id the (un)suspension is happening under. */
  orgId: string;
  audit: AuditContext;
}

export interface SuspensionDeps {
  workos: WorkOSClient;
  userRepo: UserRepo;
  membershipRepo: MembershipRepo;
  auditRepo: AuditRepo;
}

export type SuspensionErrorReason =
  /** FR23 actor-cannot-suspend-self. */
  | "self_suspension"
  /** FR23 sole-owner cannot be suspended. */
  | "sole_owner_protection"
  /** Target user does not exist locally. */
  | "user_not_found";

export class SuspensionError extends Error {
  public readonly reason: SuspensionErrorReason;
  constructor(reason: SuspensionErrorReason) {
    super(reason);
    this.reason = reason;
    this.name = "SuspensionError";
  }
}

export async function suspendUser(
  input: SuspensionInput,
  deps: SuspensionDeps,
): Promise<User> {
  if (input.actorId === input.targetId) {
    await emitFailure(input, deps, "user_suspended", "self_suspension");
    throw new SuspensionError("self_suspension");
  }

  const target = await deps.userRepo.findById(input.targetId);
  if (!target) {
    await emitFailure(input, deps, "user_suspended", "user_not_found");
    throw new SuspensionError("user_not_found");
  }

  // The single-owner partial unique (T-005) guarantees at most one
  // owner per org. If the target IS that one, they're by
  // definition the sole owner — the FR23 invariant fires.
  const owner = await deps.membershipRepo.findOwnerForOrg(input.orgId);
  if (owner && owner.userId === input.targetId) {
    await emitFailure(input, deps, "user_suspended", "sole_owner_protection");
    throw new SuspensionError("sole_owner_protection");
  }

  // FR21(b): revoke every active session BEFORE flipping our
  // lifecycle state (see file header for ordering rationale).
  // Revocations are awaited in parallel — independent per session,
  // safe to fan out, faster than sequential for any user with
  // multiple sessions.
  const sessions = await deps.workos.listSessions(target.workosUserId);
  const activeSessions = sessions.filter((s) => s.status === "active");
  await Promise.all(
    activeSessions.map((s) => deps.workos.revokeSession({ sessionId: s.id })),
  );

  // FR21(a): lifecycle flip.
  const updated = await deps.userRepo.setLifecycleState(target.id, "suspended");

  // FR21(d): audit the success.
  await safeAudit(deps, {
    eventType: "user_suspended",
    outcome: "success",
    actorUserId: input.actorId,
    targetUserId: input.targetId,
    orgId: input.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { revokedSessions: activeSessions.length },
  });
  emitCount("auth.suspension.applied");

  return updated;
}

/**
 * Reverse of suspend: flip `lifecycle_state` back to `active` and
 * audit. WorkOS sessions don't need to be touched — the suspension
 * already revoked them, and the user has to re-authenticate (which
 * mints fresh sessions).
 *
 * Self-unsuspension is impossible in practice (a suspended user
 * can't authenticate to take any action), so we don't gate on it
 * here — the absence of authentication is the gate.
 */
export async function unsuspendUser(
  input: SuspensionInput,
  deps: SuspensionDeps,
): Promise<User> {
  const target = await deps.userRepo.findById(input.targetId);
  if (!target) {
    await emitFailure(input, deps, "user_unsuspended", "user_not_found");
    throw new SuspensionError("user_not_found");
  }

  const updated = await deps.userRepo.setLifecycleState(target.id, "active");

  await safeAudit(deps, {
    eventType: "user_unsuspended",
    outcome: "success",
    actorUserId: input.actorId,
    targetUserId: input.targetId,
    orgId: input.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {},
  });
  emitCount("auth.suspension.revoked");

  return updated;
}

async function emitFailure(
  input: SuspensionInput,
  deps: SuspensionDeps,
  eventType: "user_suspended" | "user_unsuspended",
  reason: SuspensionErrorReason,
): Promise<void> {
  await safeAudit(deps, {
    eventType,
    outcome: "failure",
    actorUserId: input.actorId,
    targetUserId: input.targetId,
    orgId: input.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { reason },
  });
}
