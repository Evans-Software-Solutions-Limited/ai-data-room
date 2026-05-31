// Shared cross-org + role-check helper for the org-scoped protected
// routes (invitations CRUD, suspend / unsuspend, audit-events).
//
// Slice 1 / T-014b. Two checks rolled into one helper:
//
//   1. **Cross-org guard** — `params.orgId` (the URL-side UUID) MUST
//      match `actor.localOrgId` (the auth-context UUID resolved by
//      `resolveActor`). An editor in org A calling `/orgs/<org-B>/...`
//      gets 403, not a leaked row from another org. This is a
//      defence-in-depth check on top of whatever the application
//      function does internally — sticky #30 (Bugbot finding on PR
//      #15) shows the application function alone can be bypassed
//      when the URL parameter and the actor's resolved org differ.
//
//   2. **Role check** — handler-level authorization per sticky #22.
//      Application functions enforce data invariants only
//      (self-suspension, sole-owner protection, etc.); the
//      "owner / editor only" role check lives at the handler. This
//      helper centralises the "look up membership, assert role in
//      allowlist" pattern so individual handlers stay tight.
//
// Returns the resolved `OrgMembership` on success (handlers may
// need to inspect `membership.role` for further per-handler rules,
// e.g. only-owner-can-invite-admin in `postInvitationsHandler`),
// or a `status(403, ...)` short-circuit otherwise.

import { status } from "elysia";

import type { MembershipRepo } from "../../../infrastructure/db/membershipRepo";
import type {
  OrgMembership,
  Role,
} from "@ai-data-room/api-utils/schemas/auth-orgs";
import type { ActorContext } from "../guards/authContextTypes";

export interface AuthorizeOrgAccessInput {
  actor: ActorContext["actor"];
  paramOrgId: string;
}

export interface AuthorizeOrgAccessDeps {
  membershipRepo: MembershipRepo;
}

/** Default allowlist for org-scoped management actions — owner + editor
 * cover every FR6 / FR7 / FR10 / FR21 / audit-events case in slice
 * 1. Pass an explicit allowlist to broaden (e.g. include `viewer`)
 * if a future handler needs it. */
export const OWNER_EDITOR: ReadonlyArray<Role> = ["owner", "editor"] as const;

export async function authorizeOrgAccess(
  input: AuthorizeOrgAccessInput,
  deps: AuthorizeOrgAccessDeps,
  allowedRoles: ReadonlyArray<Role> = OWNER_EDITOR,
) {
  if (input.paramOrgId !== input.actor.localOrgId) {
    return status(403, {
      ok: false as const,
      reason: "cross_org_access" as const,
    });
  }

  const membership = await deps.membershipRepo.findByOrgUser(
    input.actor.localOrgId,
    input.actor.localUserId,
  );
  if (!membership) {
    // The actor passed `requireOrg` (so `localOrgId` is set) but has
    // no membership row in the org. Possible causes:
    //   - Race: their membership was just deleted (e.g. suspension
    //     flow that we don't yet have).
    //   - Data inconsistency: real bug.
    // Either way, 403 is correct — they're not a member.
    return status(403, {
      ok: false as const,
      reason: "not_member" as const,
    });
  }

  if (!allowedRoles.includes(membership.role)) {
    return status(403, {
      ok: false as const,
      reason: "insufficient_role" as const,
    });
  }

  return membership;
}

/**
 * Type guard for the discriminated union returned by
 * `authorizeOrgAccess`. Lets handler bodies do
 * `const auth = await authorizeOrgAccess(...); if (isAuthFailure(auth)) return auth;`
 * with type narrowing — `OrgMembership` lacks a `code` field, so
 * the presence of `code` discriminates the status-response branch.
 */
export function isAuthFailure(
  result: Awaited<ReturnType<typeof authorizeOrgAccess>>,
): result is Exclude<typeof result, OrgMembership> {
  return (
    typeof result === "object" &&
    result !== null &&
    "code" in result &&
    typeof (result as { code: unknown }).code === "number"
  );
}
