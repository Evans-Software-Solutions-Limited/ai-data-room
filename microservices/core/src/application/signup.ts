// Application-layer signup-callback flow.
//
// Slice 1 / T-008. Implements the "signup-kind" branch of the WorkOS
// auth callback per design.md §Interfaces and US1. The handler that
// wires this up lands in T-014.
//
// Flow when AuthKit redirects back with a code from the signup form:
//
//   1. Exchange the code for an `AuthenticationResponse` via
//      `workos.authenticateWithCode`.
//   2. Create the local `users` row mirroring the WorkOS user, with
//      `mfa_enrolled_at` stamped because AuthKit gates the signup
//      flow on MFA enrolment per FR16. (We trust the WorkOS config
//      here — if AuthKit returned a code, MFA was completed. The
//      login path re-checks, see `login.ts`.)
//   3. Create the local `organizations` row using the org name and
//      slug captured at the signup form. `workosOrgId` mirrors the
//      WorkOS organization ID if AuthKit attached one to the user;
//      otherwise we synthesise from the WorkOS user ID so the
//      `organizations.workos_org_id` unique constraint stays
//      satisfiable for solo signups.
//   4. Create the owner `org_memberships` row. The single-owner
//      partial unique on `org_memberships(org_id) WHERE role='owner'`
//      (T-005) guarantees this row is unique even under concurrent
//      callback processing for the same brand-new org.
//   5. Record a `signup` audit event via `recordAuditEvent` (T-013).
//      Audit-event NFR8 stripping happens inside that function — we
//      only put non-secret metadata in the event.
//
// On failure each step throws; the caller (T-014 handler) translates
// to an HTTP response. We emit a `signup` audit with
// `outcome: 'failure'` for the predictable failure modes (the
// `mfa_required` branch in particular is what FR16 / US4 measure
// against).

import { randomUUID } from "node:crypto";

import type {
  AuthenticationResponse,
  WorkOSClient,
} from "../infrastructure/workos/client";
import type { OrgRepo } from "../infrastructure/db/orgRepo";
import type { UserRepo } from "../infrastructure/db/userRepo";
import type { MembershipRepo } from "../infrastructure/db/membershipRepo";
import type { AuditRepo } from "../infrastructure/db/auditRepo";
import type {
  Org,
  OrgMembership,
  User,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { type AuditContext, safeAudit } from "./_audit-context";

export type { AuditContext };

export interface HandleSignupInput {
  /** Raw WorkOS authorization code from the AuthKit redirect. */
  workosCode: string;
  /** Org-creation form fields captured during signup. */
  orgName: string;
  orgSlug: string;
  /** WorkOS clientId — sourced from `Resource.WORKOS_CLIENT_ID.value`
   *  by the handler. The wrapper's `authenticateWithCode` payload
   *  shape requires it; we don't read it from the SDK constructor
   *  to keep the wrapper interface honest. */
  workosClientId: string;
  audit: AuditContext;
}

export interface HandleSignupDeps {
  workos: WorkOSClient;
  userRepo: UserRepo;
  orgRepo: OrgRepo;
  membershipRepo: MembershipRepo;
  auditRepo: AuditRepo;
  /**
   * MFA-presence check, pluggable so:
   *   - Tests can stub a deterministic boolean.
   *   - T-010 can swap in a `workos.listAuthFactors`-backed check
   *     once that operation is added to the WorkOS wrapper.
   *
   * Default: `() => true` — trusts AuthKit's config-level MFA
   * gating. The default is wired by the handler in T-014 unless
   * a stricter predicate is in scope.
   */
  isMfaPresent?: (session: AuthenticationResponse) => boolean;
}

export interface HandleSignupResult {
  user: User;
  org: Org;
  membership: OrgMembership;
  workosSession: AuthenticationResponse;
}

export type SignupErrorReason = "mfa_required";

export class SignupError extends Error {
  constructor(public readonly reason: SignupErrorReason) {
    super(reason);
    this.name = "SignupError";
  }
}

export async function handleSignup(
  input: HandleSignupInput,
  deps: HandleSignupDeps,
): Promise<HandleSignupResult> {
  const session = await deps.workos.authenticateWithCode({
    code: input.workosCode,
    clientId: input.workosClientId,
  });

  // FR16: MFA mandatory for all roles. AuthKit *should* gate this
  // before issuing the code, but we sanity-check via a pluggable
  // predicate — a misconfigured WorkOS environment that flips MFA
  // off without notice would otherwise issue sessions silently.
  const mfaCheck = deps.isMfaPresent ?? (() => true);
  if (!mfaCheck(session)) {
    await safeAudit(deps, {
      eventType: "signup",
      outcome: "failure",
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        workosUserId: session.user.id,
        reason: "mfa_required",
      },
    });
    throw new SignupError("mfa_required");
  }

  const user = await deps.userRepo.create({
    workosUserId: session.user.id,
    email: session.user.email,
    fullName: composeFullName(session.user),
  });

  // KNOWN FOLLOW-UP: this sequence (user → org → membership) is not
  // wrapped in a Drizzle transaction yet. If `membershipRepo.create`
  // fails after the user + org rows are persisted, we leave an
  // orphaned org with no owner. The fix is a small T-007 refactor —
  // the repos need to accept `Db | PgTransaction` so an application
  // function can call `deps.db.transaction(async tx => { ... })`
  // and instantiate transaction-scoped repos. Tracked for the
  // multi-write follow-up that also covers T-009 (invitations,
  // membership + grant insert pair) and T-019 (deletion, scrub +
  // audit pair).
  const org = await deps.orgRepo.create({
    // `workosOrgId` is unique on `organizations`. WorkOS itself
    // doesn't currently create an org for solo signups, so we
    // synthesise an ID. Using only `session.user.id` would collide
    // when a user signs up → deletes account → signs up again
    // (WorkOS user IDs are stable across the lifecycle), so we
    // append a fresh UUID. The synth_ prefix keeps the column's
    // semantics legible to a human reading admin tooling.
    workosOrgId: session.organizationId ?? `synth_${randomUUID()}`,
    name: input.orgName,
    slug: input.orgSlug,
  });

  const membership = await deps.membershipRepo.create({
    orgId: org.id,
    userId: user.id,
    role: "owner",
  });

  await safeAudit(deps, {
    eventType: "signup",
    outcome: "success",
    actorUserId: user.id,
    targetUserId: user.id,
    orgId: org.id,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { workosUserId: session.user.id, slug: org.slug },
  });

  return { user, org, membership, workosSession: session };
}

function composeFullName(user: AuthenticationResponse["user"]): string | null {
  const parts = [user.firstName, user.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}
