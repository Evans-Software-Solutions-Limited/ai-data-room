// Zod schemas for the auth-and-orgs slice (slice 1).
//
// This file is the **single source of truth** for the domain shapes
// shared between `microservices/core` (handlers + application) and
// `packages/web` (consumers). Inferred TS types are re-exported from
// `microservices/core/src/domain/{org,user,invitation,audit}.ts` so the
// domain layer reads as a barrel-per-aggregate without duplicating
// definitions.
//
// References:
// - `.kiro/specs/ai-data-room/auth-and-orgs/requirements.md` (FRs/NFRs)
// - `.kiro/specs/ai-data-room/auth-and-orgs/design.md` §Data model
//
// Scope (T-004): domain object schemas only. Request/response schemas
// for HTTP routes (e.g. the `/me` payload) land in T-014 alongside the
// handlers — keeping this file tightly scoped to the aggregates listed
// in the T-004 task spec.

import { z } from "zod";

// ─── Primitives ────────────────────────────────────────────────────────

/**
 * Membership role enum.
 *
 * Matches the `org_memberships.role` Postgres enum from design.md
 * §Data model. `external` is intentionally absent: external users
 * have `external_access_grants`, not memberships, so the membership
 * role is a strict 3-tuple. The user-facing 4-tuple
 * (owner|editor|viewer|external) is a derived projection over
 * memberships ∪ grants and lives at the API surface (T-014).
 *
 * Vocabulary is the design's `identity.js` per ADR-012 (`admin`→`editor`,
 * `internal`→`viewer`). The internal/external *category* (`kind`) is
 * orthogonal and unchanged.
 */
export const RoleSchema = z.enum(["owner", "editor", "viewer"]);

/**
 * Lifecycle state shared by `users.lifecycle_state` and
 * `organizations.status`. Same value set, same semantics; design.md
 * uses the same enum for both columns.
 */
export const LifecycleStateSchema = z.enum(["active", "suspended", "deleted"]);

/**
 * Outcome of an auditable event. Pure success/failure — anything
 * richer goes in `audit_events.metadata`.
 */
export const AuditOutcomeSchema = z.enum(["success", "failure"]);

/**
 * Audit event types — the 21 events required by auth-and-orgs FR24,
 * plus per-slice additions appended below. Order is the order they
 * appear in the FR (then by adding slice); do not reorder casually
 * (consumers may rely on `.options` ordering for dropdowns / docs).
 *
 * The exhaustiveness vs. FR24 + the per-slice additions is verified in
 * `__tests__/auth-orgs.test.ts` (the count assertion + per-name
 * presence check).
 *
 * Naming convention is snake_case throughout. `org_created` /
 * `membership_created` are the audit-log event types (system of
 * record); the EventBridge event for the same moment is the dotted
 * `org.created` (`ORG_CREATED_DETAIL_TYPE` in `schemas/org.ts`) — two
 * names for two channels, deliberately.
 */
export const AuditEventTypeSchema = z.enum([
  // auth-and-orgs (slice 1) — FR24
  "signup",
  "email_verified",
  "login_success",
  "login_failure",
  "mfa_challenge_issued",
  "mfa_success",
  "mfa_failure",
  "logout",
  "invite_sent",
  "invite_accepted",
  "invite_revoked",
  "invite_expired",
  "password_reset_requested",
  "password_reset_completed",
  "mfa_enrolled",
  "mfa_removed",
  "recovery_code_used",
  "role_changed",
  "user_suspended",
  "user_unsuspended",
  "user_deleted",
  // org-provisioning (slice 17) — T-001
  "org_created",
  "membership_created",
  // room-and-folders (slice 2) — T-006 (Opportunity subroom lifecycle, FR19)
  "opportunity_created",
  "opportunity_renamed",
  "opportunity_archived",
  // room-and-folders (slice 2) — T-007 (document upload, FR19)
  "file_uploaded",
  // room-and-folders (slice 2) — T-008
  "folder_listed",
  "file_downloaded",
]);

/**
 * Invitation kind — internal (carries a role) vs external (carries an
 * opportunity slug). The conditional invariant between `kind`,
 * `role`, and `opportunity_slug` is enforced by `InvitationSchema`'s
 * `superRefine` below.
 */
export const InvitationKindSchema = z.enum(["internal", "external"]);

/**
 * Invitation lifecycle state — see design.md §Data model
 * `invitations.state`.
 */
export const InvitationStateSchema = z.enum([
  "pending",
  "accepted",
  "revoked",
  "expired",
]);

/**
 * Invitable role — `owner` is intentionally excluded. Per design.md,
 * single-owner-per-org is enforced by a unique partial index, and
 * ownership is established at signup, never via invite.
 */
export const InvitationRoleSchema = z.enum(["editor", "viewer"]);

/**
 * External-access-grant status. Slice 1 only writes `active`/`revoked`;
 * the `expired` transition lives in `access-control` (slice 3) and is
 * driven by the `expiresAt` column per FR8b. Forward-compat at this
 * slice — keeping the enum closed prevents the slice-3 PR from being
 * a coupled schema-and-application change.
 */
export const ExternalAccessGrantStatusSchema = z.enum([
  "active",
  "revoked",
  "expired",
]);

/**
 * Slug regex for `organizations.slug` and (later) opportunity slugs.
 * Lowercase alphanumerics with optional internal hyphens; no leading
 * or trailing hyphen, no consecutive hyphens. Kept permissive at the
 * domain layer — the application layer can layer on stricter rules
 * (length caps, reserved-word blocks).
 */
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SlugSchema = z.string().min(1).max(64).regex(SLUG_REGEX, {
  message: "slug must be lowercase alphanumeric with optional internal hyphens",
});

// ─── Aggregates ────────────────────────────────────────────────────────

/**
 * `organizations` row. `status` reuses `LifecycleState` because the
 * value set is identical to `users.lifecycle_state` (design.md
 * §Data model).
 */
export const OrgSchema = z.object({
  id: z.string().uuid(),
  workosOrgId: z.string().min(1),
  name: z.string().min(1),
  slug: SlugSchema,
  status: LifecycleStateSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * `users` row. `email` and `fullName` are nullable to support GDPR
 * hard-delete (NFR9): on `lifecycleState = 'deleted'` we null PII
 * columns and retain `workosUserId` as a tombstone so audit joins
 * still resolve. The "non-null when active" invariant lives at the
 * application layer, not the schema.
 */
export const UserSchema = z.object({
  id: z.string().uuid(),
  workosUserId: z.string().min(1),
  email: z.string().email().nullable(),
  fullName: z.string().min(1).nullable(),
  lifecycleState: LifecycleStateSchema,
  emailVerifiedAt: z.coerce.date().nullable(),
  mfaEnrolledAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * `org_memberships` row. One per (user, org) pair; `role` is the
 * 3-tuple membership role. External users have no row here.
 */
export const OrgMembershipSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: RoleSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * `external_access_grants` row. External users get one or more grants
 * scoped to an Opportunity instead of a membership. `opportunitySlug`
 * is a string at v0.1 — when `room-and-folders` lands it becomes an
 * FK, but we don't take that dependency here. `expiresAt` is FR8b's
 * 90-day default written by `acceptInvitation`; slice 3 enforces.
 */
export const ExternalAccessGrantSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  opportunitySlug: SlugSchema,
  grantedBy: z.string().uuid(),
  status: ExternalAccessGrantStatusSchema,
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

/**
 * `invitations` row. The `(kind, role, opportunitySlug)` triple is
 * mutually constrained — `superRefine` enforces design.md's
 * §Data model rule that internal invites carry a role and no slug,
 * external invites carry a slug and no role.
 */
export const InvitationSchema = z
  .object({
    id: z.string().uuid(),
    workosInvitationId: z.string().min(1),
    orgId: z.string().uuid(),
    email: z.string().email(),
    kind: InvitationKindSchema,
    role: InvitationRoleSchema.nullable(),
    opportunitySlug: SlugSchema.nullable(),
    invitedBy: z.string().uuid(),
    state: InvitationStateSchema,
    expiresAt: z.coerce.date(),
    acceptedAt: z.coerce.date().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .superRefine((inv, ctx) => {
    if (inv.kind === "internal") {
      if (inv.role === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["role"],
          message: "internal invitations must specify a role",
        });
      }
      if (inv.opportunitySlug !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["opportunitySlug"],
          message: "internal invitations must not carry an opportunitySlug",
        });
      }
    } else {
      if (inv.role !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["role"],
          message: "external invitations must not specify a role",
        });
      }
      if (inv.opportunitySlug === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["opportunitySlug"],
          message: "external invitations must carry an opportunitySlug",
        });
      }
    }
  });

/**
 * `audit_events` row. Append-only by convention in v0.1 (NFR10:
 * future SOC 2). `metadata` is event-type-specific, but NFR8 forbids
 * sensitive material there — enforcement is on the writer (T-013),
 * not the schema.
 *
 * `sourceIp` accepts any IPv4 or IPv6 string — Postgres `inet` is
 * strictly typed, so an upstream parsing failure surfaces here long
 * before it would reach the DB.
 */
export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.coerce.date(),
  eventType: AuditEventTypeSchema,
  actorUserId: z.string().uuid().nullable(),
  targetUserId: z.string().uuid().nullable(),
  orgId: z.string().uuid().nullable(),
  sourceIp: z.string().ip(),
  userAgent: z.string(),
  outcome: AuditOutcomeSchema,
  metadata: z.record(z.string(), z.unknown()),
});

// ─── Inferred types (re-exported from `core/src/domain/*.ts`) ──────────

export type Role = z.infer<typeof RoleSchema>;
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;
export type InvitationKind = z.infer<typeof InvitationKindSchema>;
export type InvitationState = z.infer<typeof InvitationStateSchema>;
export type InvitationRole = z.infer<typeof InvitationRoleSchema>;
export type ExternalAccessGrantStatus = z.infer<
  typeof ExternalAccessGrantStatusSchema
>;

export type Org = z.infer<typeof OrgSchema>;
export type User = z.infer<typeof UserSchema>;
export type OrgMembership = z.infer<typeof OrgMembershipSchema>;
export type ExternalAccessGrant = z.infer<typeof ExternalAccessGrantSchema>;
export type Invitation = z.infer<typeof InvitationSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
