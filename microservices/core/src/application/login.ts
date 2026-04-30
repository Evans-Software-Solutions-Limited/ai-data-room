// Application-layer login-callback flow.
//
// Slice 1 / T-008. The "login-kind" branch of the WorkOS auth
// callback per design.md §Interfaces. Sibling to `signup.ts`; kept
// in a separate file because the responsibilities and failure modes
// diverge (signup writes new rows, login reads existing rows + gates
// on lifecycle / MFA state we already mirrored from earlier signups).
//
// Flow when AuthKit redirects back with a code from a returning
// user's login form:
//
//   1. Exchange the code for an `AuthenticationResponse`.
//   2. Look up our local `users` row by `workos_user_id`. Reject
//      `user_not_found` if this is somehow a fresh user the signup
//      flow never created (data inconsistency — the webhook may not
//      have caught up, or the user signed up via a path we don't
//      handle).
//   3. Reject `user_suspended` if `lifecycleState !== 'active'` per
//      FR21(c) "reject future login attempts with a clear 'account
//      suspended' message".
//   4. Reject `mfa_required` if `mfaEnrolledAt === null`. The mirror
//      is populated by the T-010 webhook; if we get here without it
//      set, either the user genuinely hasn't enrolled (FR16
//      violation that AuthKit should have prevented) or the webhook
//      mirror is lagging. Fail-closed is correct.
//   5. Resolve the membership for context (null for external users
//      who have grants instead of memberships — slice 3 expands
//      this).
//   6. Record `login_success` audit event. Each rejection path
//      emits `login_failure` with the reason in metadata.

import type {
  AuthenticationResponse,
  WorkOSClient,
} from "../infrastructure/workos/client";
import type { AuditRepo } from "../infrastructure/db/auditRepo";
import type { MembershipRepo } from "../infrastructure/db/membershipRepo";
import type { OrgRepo } from "../infrastructure/db/orgRepo";
import type { UserRepo } from "../infrastructure/db/userRepo";
import type {
  OrgMembership,
  User,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { type AuditContext, safeAudit } from "./_audit-context";

export interface HandleLoginCallbackInput {
  workosCode: string;
  workosClientId: string;
  audit: AuditContext;
}

export interface HandleLoginCallbackDeps {
  workos: WorkOSClient;
  userRepo: UserRepo;
  orgRepo: OrgRepo;
  membershipRepo: MembershipRepo;
  auditRepo: AuditRepo;
  /** See `signup.ts#HandleSignupDeps.isMfaPresent` for rationale. */
  isMfaPresent?: (session: AuthenticationResponse) => boolean;
}

export interface HandleLoginCallbackResult {
  user: User;
  /** Null for external users (they have access grants, not
   *  memberships — slice 3). */
  membership: OrgMembership | null;
  workosSession: AuthenticationResponse;
}

export type LoginErrorReason =
  | "user_not_found"
  | "user_suspended"
  | "mfa_required";

export class LoginError extends Error {
  constructor(public readonly reason: LoginErrorReason) {
    super(reason);
    this.name = "LoginError";
  }
}

export async function handleLoginCallback(
  input: HandleLoginCallbackInput,
  deps: HandleLoginCallbackDeps,
): Promise<HandleLoginCallbackResult> {
  const session = await deps.workos.authenticateWithCode({
    code: input.workosCode,
    clientId: input.workosClientId,
  });

  const user = await deps.userRepo.findByWorkosUserId(session.user.id);
  if (!user) {
    await safeAudit(deps, {
      eventType: "login_failure",
      outcome: "failure",
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        workosUserId: session.user.id,
        reason: "user_not_found",
      },
    });
    throw new LoginError("user_not_found");
  }

  if (user.lifecycleState !== "active") {
    await safeAudit(deps, {
      eventType: "login_failure",
      outcome: "failure",
      actorUserId: user.id,
      targetUserId: user.id,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        workosUserId: session.user.id,
        reason: "user_suspended",
        lifecycleState: user.lifecycleState,
      },
    });
    throw new LoginError("user_suspended");
  }

  const mfaCheck = deps.isMfaPresent ?? (() => true);
  if (!mfaCheck(session) || user.mfaEnrolledAt === null) {
    await safeAudit(deps, {
      eventType: "login_failure",
      outcome: "failure",
      actorUserId: user.id,
      targetUserId: user.id,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        workosUserId: session.user.id,
        reason: "mfa_required",
      },
    });
    throw new LoginError("mfa_required");
  }

  // Membership lookup is per-org. `session.organizationId` is the
  // WorkOS-side text id (e.g. `org_01E...`) — NOT our local UUID.
  // We resolve it through `orgRepo.findByWorkosOrgId` first because
  // `org_memberships.org_id` is `uuid REFERENCES organizations.id`;
  // passing the WorkOS id directly would either throw "invalid input
  // syntax for type uuid" at the db driver or (worse) silently
  // return null and make every returning user look external.
  //
  // If WorkOS attached an org id we don't mirror locally, the
  // membership lookup yields null and the user logs in without an
  // org context. That's correct for external users (slice 3
  // expands their grant resolution) and a graceful fail for any
  // org-mirror lag (the user can still see /me; admin tooling
  // surfaces the inconsistency separately).
  let membership = null;
  if (session.organizationId) {
    const localOrg = await deps.orgRepo.findByWorkosOrgId(
      session.organizationId,
    );
    if (localOrg) {
      membership = await deps.membershipRepo.findByOrgUser(
        localOrg.id,
        user.id,
      );
    }
  }

  await safeAudit(deps, {
    eventType: "login_success",
    outcome: "success",
    actorUserId: user.id,
    targetUserId: user.id,
    orgId: membership?.orgId ?? null,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { workosUserId: session.user.id },
  });

  return { user, membership, workosSession: session };
}
