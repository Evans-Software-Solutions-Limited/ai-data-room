// Application-layer invitations flow — covers the FR6 / FR7 / FR10
// invitation lifecycle for slice 1.
//
// Authorization split: handlers gate "signed in + some org role";
// this file enforces the domain-specific role rules — only owner
// can invite an editor (FR6 / FR7), and revoke requires owner-or-
// editor role.
//
// `acceptInvitation` is webhook-driven and idempotent under WorkOS
// at-least-once redelivery — missing invitation returns null
// rather than throwing; non-pending state returns null + audits
// failure; the in-tx user lookup uses find-or-create so a re-fired
// webhook doesn't double-create. Multi-write atomicity is via the
// `withTx` factory pattern that landed before this PR.

import type {
  Invitation as WorkOSInvitation,
  WorkOSClient,
} from "../infrastructure/workos/client";
import type { AuditRepo } from "../infrastructure/db/auditRepo";
import type { TenantBootstrapRepo } from "../infrastructure/db/bootstrapRepo";
import type { InvitationRepo } from "../infrastructure/db/invitationRepo";
import type { OrgRepo } from "../infrastructure/db/orgRepo";
import { scopedRepo } from "../infrastructure/db/scoped";
import type { UserRepo } from "../infrastructure/db/userRepo";
import type { Db } from "@ai-data-room/db";
import type {
  ExternalAccessGrant,
  Invitation,
  InvitationRole,
  OrgMembership,
  Role,
  User,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { emitCount } from "../infrastructure/observability/metrics";
import { type AuditContext, safeAudit } from "./_audit-context";

/** FR8b — default external-access-grant TTL: 90 days from issuance.
 *  Override / extension knobs (up to a 365-day ceiling) land in
 *  `access-control` (slice 3); this constant is the slice-1 default
 *  used by `acceptInvitation`'s grant insert. The DB column carries
 *  a matching default as defence-in-depth, but the application is
 *  the policy owner so the value lives here too. */
const EXTERNAL_GRANT_DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type InvitationErrorReason =
  /** Actor's org role is `viewer` or otherwise insufficient — FR6 / FR7
   * permit only owner / editor to issue or revoke invites. */
  | "actor_role_insufficient"
  /** Editor-role invite issued by a non-owner — FR6 reserves editor
   * promotion to the owner. */
  | "only_owner_can_invite_editor"
  /** Lookup miss on revoke. */
  | "invitation_not_found"
  /** Revoke against an invite that's already accepted / expired /
   * previously revoked — FR10 is "revoke unaccepted invite". */
  | "invitation_not_pending"
  /** Inviter row missing locally — usually a data-integrity bug
   * since the inviter's session shouldn't exist without the row. */
  | "inviter_user_not_found"
  /** Org row missing locally — same shape as above. */
  | "org_not_found"
  /** Invitation row violates the schema's `(kind, role,
   * opportunity_slug)` invariant — e.g. an internal invite with a
   * null role. Defends `acceptInvitation` against DB drift (a manual
   * UPDATE bypassing the schema) by surfacing a typed error rather
   * than an opaque NOT NULL constraint violation from Drizzle. */
  | "invitation_invariant_violation"
  /** Atomic state transition lost a race against a concurrent caller
   * — e.g. two `invitation.accepted` webhook deliveries arriving in
   * parallel, or a `revokeInvitation` racing against an
   * `acceptInvitation`. The application layer uses
   * `invitationRepo.transitionState` (compare-and-set) to detect
   * this and roll back partial multi-write effects. */
  | "invitation_state_race";

export class InvitationError extends Error {
  public readonly reason: InvitationErrorReason;
  constructor(reason: InvitationErrorReason) {
    super(reason);
    this.reason = reason;
    this.name = "InvitationError";
  }
}

// ---------------------------------------------------------------------------
// createInvitation
// ---------------------------------------------------------------------------

interface CreateInvitationInputBase {
  email: string;
  orgId: string;
  actorId: string;
  /** Actor's role in the org. The handler layer is responsible for
   * resolving this; the application layer enforces the role-vs-action
   * rules (only owner can invite editor). */
  actorRole: Role;
  audit: AuditContext;
}

export type CreateInvitationInput = CreateInvitationInputBase &
  (
    | {
        kind: "internal";
        role: InvitationRole;
        opportunitySlug?: never;
      }
    | {
        kind: "external";
        opportunitySlug: string;
        role?: never;
      }
  );

export interface CreateInvitationDeps {
  workos: WorkOSClient;
  userRepo: UserRepo;
  orgRepo: OrgRepo;
  /** The caller's scoped invitation repo (`ctx.scoped.invitations`) —
   *  already bound to `orgId` (T-004), so `.create()` no longer takes
   *  it explicitly. */
  invitations: InvitationRepo;
  auditRepo: AuditRepo;
}

export async function createInvitation(
  input: CreateInvitationInput,
  deps: CreateInvitationDeps,
): Promise<Invitation> {
  // Authorization invariants (FR6 / FR7).
  if (input.actorRole !== "owner" && input.actorRole !== "editor") {
    await emitFailure(deps, input, "invite_sent", "actor_role_insufficient");
    throw new InvitationError("actor_role_insufficient");
  }
  if (
    input.kind === "internal" &&
    input.role === "editor" &&
    input.actorRole !== "owner"
  ) {
    await emitFailure(
      deps,
      input,
      "invite_sent",
      "only_owner_can_invite_editor",
    );
    throw new InvitationError("only_owner_can_invite_editor");
  }

  // The WorkOS `sendInvitation` call needs `inviterUserId` (their
  // side's id) and `organizationId` (their side's id). We resolve
  // both from our local mirror so we never expose a local UUID
  // across the WorkOS boundary.
  const [actor, org] = await Promise.all([
    deps.userRepo.findById(input.actorId),
    deps.orgRepo.findById(input.orgId),
  ]);
  if (!actor) {
    await emitFailure(deps, input, "invite_sent", "inviter_user_not_found");
    throw new InvitationError("inviter_user_not_found");
  }
  if (!org) {
    await emitFailure(deps, input, "invite_sent", "org_not_found");
    throw new InvitationError("org_not_found");
  }

  // External call before local write. If the local mirror fails
  // afterwards, we have a "live" WorkOS invite that doesn't exist
  // in our DB — the audit row carries the WorkOS id so an operator
  // can revoke it manually. Wrapping in a DB transaction is not
  // possible here because WorkOS is an external API; the standard
  // outbox pattern is the proper long-term fix and is out of scope.
  const workosInvite: WorkOSInvitation = await deps.workos.createInvitation({
    email: input.email,
    organizationId: org.workosOrgId,
    inviterUserId: actor.workosUserId,
    expiresInDays: 7,
  });

  const invitation = await deps.invitations.create({
    workosInvitationId: workosInvite.id,
    email: input.email,
    kind: input.kind,
    role: input.kind === "internal" ? input.role : null,
    opportunitySlug: input.kind === "external" ? input.opportunitySlug : null,
    invitedBy: input.actorId,
    expiresAt: new Date(workosInvite.expiresAt),
  });

  await safeAudit(deps, {
    eventType: "invite_sent",
    outcome: "success",
    actorUserId: input.actorId,
    orgId: input.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      invitationId: invitation.id,
      workosInvitationId: workosInvite.id,
      email: input.email,
      kind: input.kind,
      ...(input.kind === "internal"
        ? { role: input.role }
        : { opportunitySlug: input.opportunitySlug }),
    },
  });
  emitCount("auth.invite.sent");

  return invitation;
}

// ---------------------------------------------------------------------------
// listInvitations
// ---------------------------------------------------------------------------

export interface ListInvitationsInput {
  /** Defaults to `pending` — the admin UI's primary case. Pass other
   * states explicitly when surfacing audit history. */
  state?: Invitation["state"];
}

export interface ListInvitationsDeps {
  /** The caller's scoped invitation repo (`ctx.scoped.invitations`) —
   *  org is implicit in the scope, so this no longer takes an
   *  explicit `orgId` (T-004; was `{ orgId, state }` /
   *  `listByOrgAndState`). */
  invitations: InvitationRepo;
}

/**
 * Read-only — no audit emission. The list endpoint returns 0+ rows
 * for the requested state, scoped to the caller's org.
 */
export async function listInvitations(
  input: ListInvitationsInput,
  deps: ListInvitationsDeps,
): Promise<Invitation[]> {
  return deps.invitations.listByState(input.state ?? "pending");
}

// ---------------------------------------------------------------------------
// revokeInvitation
// ---------------------------------------------------------------------------

export interface RevokeInvitationInput {
  invitationId: string;
  orgId: string;
  actorId: string;
  actorRole: Role;
  audit: AuditContext;
}

export interface RevokeInvitationDeps {
  workos: WorkOSClient;
  /** The caller's scoped invitation repo (`ctx.scoped.invitations`) —
   *  see the T-004 note on `findById` below. */
  invitations: InvitationRepo;
  auditRepo: AuditRepo;
}

export async function revokeInvitation(
  input: RevokeInvitationInput,
  deps: RevokeInvitationDeps,
): Promise<Invitation> {
  if (input.actorRole !== "owner" && input.actorRole !== "editor") {
    await emitFailure(deps, input, "invite_revoked", "actor_role_insufficient");
    throw new InvitationError("actor_role_insufficient");
  }

  // T-004: `deps.invitations` is already bound to `input.orgId` (the
  // scoped repo the handler built from `ctx.scoped`), so `findById`
  // itself excludes any row belonging to a foreign org — a tenant-A
  // editor passing a tenant-B invitation id resolves to `null` here,
  // identically to a genuinely nonexistent id. This SUBSUMES the
  // pre-T-004 `invitation.orgId !== input.orgId` cross-org branch:
  // that branch is now unreachable (the scoped query can't even
  // return a foreign-org row to compare against), so it's removed
  // rather than left as dead code. One accepted, minor regression:
  // the failure-audit's `actualOrgId` metadata (previously recorded
  // for forensics on a cross-org probe) is no longer available here,
  // because the scoped read doesn't distinguish "doesn't exist" from
  // "exists in another org" — which is exactly the isolation
  // guarantee this slice exists to provide.
  const invitation = await deps.invitations.findById(input.invitationId);
  if (!invitation) {
    await safeAudit(deps, {
      eventType: "invite_revoked",
      outcome: "failure",
      actorUserId: input.actorId,
      orgId: input.orgId,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: { reason: "invitation_not_found" },
    });
    throw new InvitationError("invitation_not_found");
  }

  if (invitation.state !== "pending") {
    await emitFailure(deps, input, "invite_revoked", "invitation_not_pending");
    throw new InvitationError("invitation_not_pending");
  }

  // WorkOS revoke first — same ordering rationale as createInvitation:
  // if the local update fails after WorkOS revokes, the audit row
  // captures the workosInvitationId for manual reconciliation. The
  // alternative (local first, WorkOS second) is worse because a
  // user could still accept via a stale WorkOS-side token.
  await deps.workos.revokeInvitation(invitation.workosInvitationId);

  // Conditional update: only flip state if the row is still pending.
  // A concurrent `acceptInvitation` webhook delivery between our
  // lookup above and this UPDATE would otherwise have its `accepted`
  // state silently clobbered. The WorkOS-side revoke is already
  // done and irreversible — that's an unavoidable consequence of
  // the external-then-local ordering — but the local audit trail
  // stays accurate.
  const updated = await deps.invitations.transitionState(
    invitation.id,
    "pending",
    "revoked",
  );
  if (!updated) {
    await emitFailure(deps, input, "invite_revoked", "invitation_state_race");
    throw new InvitationError("invitation_state_race");
  }

  await safeAudit(deps, {
    eventType: "invite_revoked",
    outcome: "success",
    actorUserId: input.actorId,
    // Source-of-truth from the row, not the request — they are
    // equal here (cross-org check above), but using the row's value
    // means the audit is correct by construction even if the guard
    // is ever weakened.
    orgId: invitation.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      invitationId: invitation.id,
      workosInvitationId: invitation.workosInvitationId,
    },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// acceptInvitation
// ---------------------------------------------------------------------------

export interface AcceptInvitationInput {
  workosInvitationId: string;
  /** WorkOS user id from the webhook payload — the user who accepted. */
  workosUserId: string;
  /** Email + name from the webhook payload — used to seed the local
   * `users` row when we don't already mirror this WorkOS user. */
  email: string;
  fullName: string | null;
  emailVerified: boolean;
  audit: AuditContext;
}

export interface AcceptInvitationDeps {
  db: Db;
  userRepo: UserRepo;
  /** Webhook-driven bootstrap read — discovers the invitation (and
   *  hence its `orgId`) BEFORE any tenant context exists (T-004). Once
   *  `invitation.orgId` is known, the function binds
   *  `scopedRepo(invitation.orgId, tx)` itself for every write inside
   *  the transaction below. */
  bootstrap: TenantBootstrapRepo;
  auditRepo: AuditRepo;
}

export interface AcceptInvitationResult {
  /** Null on idempotent no-op (unknown invitation or already-accepted
   * state) so the webhook handler can ack without retrying. */
  invitation: Invitation | null;
  user: User | null;
  /** Set for internal invites; null for external. */
  membership: OrgMembership | null;
  /** Set for external invites; null for internal. */
  grant: ExternalAccessGrant | null;
}

export async function acceptInvitation(
  input: AcceptInvitationInput,
  deps: AcceptInvitationDeps,
): Promise<AcceptInvitationResult> {
  const invitation = await deps.bootstrap.findInvitationByWorkosId(
    input.workosInvitationId,
  );
  if (!invitation) {
    await safeAudit(deps, {
      eventType: "invite_accepted",
      outcome: "failure",
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        reason: "invitation_not_found",
        workosInvitationId: input.workosInvitationId,
      },
    });
    return { invitation: null, user: null, membership: null, grant: null };
  }

  if (invitation.state !== "pending") {
    // Webhook redelivery for an already-accepted invite is the
    // common case here. The first delivery flipped state to
    // `accepted`; the redelivery sees `accepted` and no-ops.
    await safeAudit(deps, {
      eventType: "invite_accepted",
      outcome: "failure",
      orgId: invitation.orgId,
      sourceIp: input.audit.sourceIp,
      userAgent: input.audit.userAgent,
      metadata: {
        reason: "invitation_not_pending",
        invitationId: invitation.id,
        currentState: invitation.state,
      },
    });
    return { invitation, user: null, membership: null, grant: null };
  }

  // The user / membership-or-grant / invitation-state writes all
  // need to commit together — a partial failure would leave the
  // invitation pending with a half-built grant or vice versa, which
  // would block the user from re-accepting. Mirrors the signup.ts
  // pattern that landed in the txn-wrapper PR.
  //
  // Note: WorkOS sends user data with the webhook, so we mirror
  // here rather than calling `getUser` separately. AuthKit guarantees
  // the user finished MFA enrolment before we reach this point
  // (FR16), so `mfaEnrolledAt` is stamped at create-time — same
  // rationale as signup.ts.
  const now = new Date();
  let result;
  try {
    result = await deps.db.transaction(async (tx) => {
      const userTx = deps.userRepo.withTx(tx);
      // T-004: `invitation.orgId` is only known NOW (we just read the
      // row via the unscoped `bootstrap` lookup above) — the scope is
      // bound here, inside the tx, rather than passed in from the
      // caller. This is the same bootstrap reasoning as `createOrg`:
      // you can't demand the org up front when discovering it is the
      // whole point of the read that came before it.
      const scoped = scopedRepo(invitation.orgId, tx);

      // Find-or-create on the user mirror. Webhook redelivery for a
      // user we've already mirrored (e.g. a re-invited user) hits the
      // existing row and skips the insert.
      const existing = await userTx.findByWorkosUserId(input.workosUserId);
      const user =
        existing ??
        (await userTx.create({
          workosUserId: input.workosUserId,
          email: input.email,
          fullName: input.fullName,
          mfaEnrolledAt: now,
          emailVerifiedAt: input.emailVerified ? now : null,
        }));

      let membership: OrgMembership | null = null;
      let grant: ExternalAccessGrant | null = null;

      if (invitation.kind === "internal") {
        // Schema's `superRefine` enforces `role !== null` when
        // `kind === "internal"`, but the row comes from the DB
        // unparsed — a manual UPDATE bypassing the schema would let
        // null through. Explicit guard surfaces a typed error rather
        // than Drizzle's opaque NOT NULL violation.
        if (invitation.role === null) {
          throw new InvitationError("invitation_invariant_violation");
        }
        membership = await scoped.membership.create({
          userId: user.id,
          role: invitation.role,
        });
      } else {
        if (invitation.opportunitySlug === null) {
          throw new InvitationError("invitation_invariant_violation");
        }
        grant = await scoped.externalGrants.create({
          userId: user.id,
          opportunitySlug: invitation.opportunitySlug,
          grantedBy: invitation.invitedBy,
          expiresAt: new Date(now.getTime() + EXTERNAL_GRANT_DEFAULT_TTL_MS),
        });
      }

      // Conditional update: closes the TOCTOU race against another
      // concurrent webhook delivery (or a `revokeInvitation` running
      // in parallel). If the row is no longer pending, throw — Drizzle
      // rolls back the user / membership / grant inserts above, so we
      // can't end up with a duplicate `external_access_grants` row
      // (which has no unique index that would otherwise catch it) or
      // a clobbered `revoked` state.
      const updatedInvitation = await scoped.invitations.transitionState(
        invitation.id,
        "pending",
        "accepted",
      );
      if (!updatedInvitation) {
        throw new InvitationError("invitation_state_race");
      }

      return { invitation: updatedInvitation, user, membership, grant };
    });
  } catch (err) {
    // Audit the race-loss (the most common reason this throws under
    // load) and re-throw. Other in-tx errors — schema-invariant,
    // FK / unique-index violations from the DB — also flow through
    // here; we record them with a generic failure shape so an
    // operator can correlate. The webhook routing layer will
    // translate the throw into a non-2xx so WorkOS retries.
    if (err instanceof InvitationError) {
      await safeAudit(deps, {
        eventType: "invite_accepted",
        outcome: "failure",
        orgId: invitation.orgId,
        sourceIp: input.audit.sourceIp,
        userAgent: input.audit.userAgent,
        metadata: {
          reason: err.reason,
          invitationId: invitation.id,
          workosInvitationId: invitation.workosInvitationId,
        },
      });
    }
    throw err;
  }

  await safeAudit(deps, {
    eventType: "invite_accepted",
    outcome: "success",
    actorUserId: result.user.id,
    targetUserId: result.user.id,
    orgId: invitation.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: {
      invitationId: invitation.id,
      workosInvitationId: invitation.workosInvitationId,
      kind: invitation.kind,
      ...(invitation.kind === "internal"
        ? { role: invitation.role }
        : { opportunitySlug: invitation.opportunitySlug }),
    },
  });
  emitCount("auth.invite.accepted");

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Shared shape for failure-audit emission across the two write paths
 * (create + revoke). The two webhook-driven failure paths in
 * `acceptInvitation` use `safeAudit` directly — they have neither an
 * `actorId` (no authenticated session) nor always an `orgId` (the
 * invitation_not_found branch hasn't resolved one).
 */
async function emitFailure(
  deps: { auditRepo: AuditRepo },
  input: {
    actorId: string;
    orgId: string;
    audit: AuditContext;
  },
  eventType: "invite_sent" | "invite_revoked",
  reason: InvitationErrorReason,
): Promise<void> {
  await safeAudit(deps, {
    eventType,
    outcome: "failure",
    actorUserId: input.actorId,
    orgId: input.orgId,
    sourceIp: input.audit.sourceIp,
    userAgent: input.audit.userAgent,
    metadata: { reason },
  });
}
