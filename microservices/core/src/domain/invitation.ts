// Domain barrel: invitation + external-access-grant aggregates.
//
// Both invitations (the act of asking someone to join) and external
// access grants (the resulting per-Opportunity scope for an external
// user) live here because they share the "join the org" lifecycle:
// an external invite that's accepted produces an
// ExternalAccessGrant; an internal invite produces an OrgMembership
// (see `org.ts`).
//
// Pure type re-exports — see `org.ts` for the rationale.

export type {
  Invitation,
  InvitationKind,
  InvitationState,
  InvitationRole,
  ExternalAccessGrant,
  ExternalAccessGrantStatus,
} from "@ai-data-room/api-utils/schemas/auth-orgs";
