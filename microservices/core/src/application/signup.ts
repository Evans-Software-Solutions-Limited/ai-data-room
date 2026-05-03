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
import type { Db } from "@ai-data-room/db";
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
  /**
   * Drizzle client used as the outer transaction boundary for the
   * user / org / membership multi-write. Repos still come in
   * pre-constructed; we call `repo.withTx(tx)` inside the callback
   * to swap them onto the transaction handle.
   */
  db: Db;
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

  // Stamp `mfaEnrolledAt` and (conditionally) `emailVerifiedAt` at
  // create-time so the user can log in immediately after signup —
  // without this, every login that runs before the T-010 webhook
  // backfills these mirror columns would fail the
  // `mfaEnrolledAt === null → mfa_required` gate in `login.ts`.
  // AuthKit guarantees MFA was enrolled before issuing the code
  // (FR16 + per-org config), so stamping `now()` is correct at
  // this layer — the webhook will idempotently re-stamp the same
  // value when it arrives.
  // The user / org / membership writes are wrapped in a single
  // Drizzle transaction so a mid-sequence failure rolls every row
  // back atomically. Without this, a `membershipRepo.create` failure
  // after the user + org rows commit would leave an orphan org with
  // no owner — the single-owner partial unique would then block
  // re-signup attempts that try to attach a fresh owner.
  //
  // The audit write stays OUTSIDE the transaction (via `safeAudit`
  // after commit) so that an audit-write failure doesn't roll the
  // user/org/membership back, and so a transaction rollback doesn't
  // erase the audit row of a failure we wanted to record.
  const now = new Date();
  // The three writes below MUST stay sequential — a Drizzle tx
  // wraps a single Postgres connection, so concurrent awaits on the
  // same tx interleave commands on one wire and risk
  // `another command is already in progress` errors.
  const { user, org, membership } = await deps.db.transaction(async (tx) => {
    const userTx = deps.userRepo.withTx(tx);
    const orgTx = deps.orgRepo.withTx(tx);
    const membershipTx = deps.membershipRepo.withTx(tx);

    // Stamp `mfaEnrolledAt` and (conditionally) `emailVerifiedAt` at
    // create-time so the user can log in immediately after signup;
    // without this, every login that runs before the T-010 webhook
    // backfills these mirror columns would fail the
    // `mfaEnrolledAt === null → mfa_required` gate in `login.ts`.
    // AuthKit guarantees MFA was enrolled before issuing the code
    // (FR16), so stamping `now()` is correct at this layer — the
    // webhook will idempotently re-stamp the same value when it
    // arrives.
    const user = await userTx.create({
      workosUserId: session.user.id,
      email: session.user.email,
      fullName: composeFullName(session.user),
      mfaEnrolledAt: now,
      emailVerifiedAt: session.user.emailVerified ? now : null,
    });

    const org = await orgTx.create({
      // WorkOS doesn't create an org for solo signups, so we
      // synthesise an ID. Using only `session.user.id` would collide
      // on signup → delete → re-signup (WorkOS user IDs are stable
      // across the lifecycle), so we append a fresh UUID. The
      // `synth_` prefix keeps the column legible in admin tooling.
      workosOrgId: session.organizationId ?? `synth_${randomUUID()}`,
      name: input.orgName,
      slug: input.orgSlug,
    });

    const membership = await membershipTx.create({
      orgId: org.id,
      userId: user.id,
      role: "owner",
    });

    return { user, org, membership };
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
