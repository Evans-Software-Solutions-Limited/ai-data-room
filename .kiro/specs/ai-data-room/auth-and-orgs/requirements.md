# Requirements — ai-data-room / auth-and-orgs

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-04-21
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)

## Context

Foundation slice for `ai-data-room`. Every other slice (rooms, access
control, checklists, AI, billing, admin) presumes a working identity,
organisation (tenant), role, and session model. This slice delivers that
foundation — nothing downstream of it (folder contents, documents, AI
answers) is in scope here.

Solution choices (library, provider, DB schema) belong in `design.md`,
not here.

## Users & roles

### Primary user

A founder / ops lead / compliance owner at a B2B SME who is signing up
for the product and will invite colleagues + external parties into their
room.

### Secondary users

- **Colleagues** of the primary user — admins and internal contributors
  who manage content inside the org's room.
- **External viewers** — vendors, banks, VCs, M&A buyers, RFP issuers —
  who receive scoped, time-boxed access to specific `Opportunities/`
  subrooms but are never members of the host org.

### Roles (v0.1)

- `owner` — one per org at signup; full control; MFA required.
- `admin` — invited by owner; manages content, invites, and
  configuration; MFA required.
- `internal` — invited by owner/admin; contributes content but cannot
  invite externals or change org settings; MFA required.
- `external` — invited to a specific Opportunity subroom; no org
  membership; **MFA required** (same bar as internal users — revisit in
  a later slice if external-user friction becomes a real problem);
  shortest session lifetime.

### User lifecycle states (v0.1)

Independent of role, every user is in exactly one of:

- `active` — can log in, take actions consistent with their role.
- `suspended` — cannot log in; existing sessions terminated; data and
  audit attribution preserved; can be reactivated by an admin/owner.
- `deleted` — hard-deleted for GDPR; user record tombstoned so audit
  trail remains attributable to a stable id but PII is removed.

> Enforcement of what each role can _see_ (folder/file access) lives in
> the `access-control` slice. This slice only establishes identity and
> role assignment.

## User stories

- **US1** — _As a new business, I want to self-serve signup so I can
  create an org and owner account without sales friction._
- **US2** — _As an owner, I want to invite colleagues with pre-assigned
  roles so they can help manage our data room._
- **US3** — _As an owner or admin, I want to invite external viewers
  scoped to a specific Opportunity so they can access only what I grant._
- **US4** — _As any internal user, I want MFA on my account so that
  stolen credentials alone don't grant room access._
- **US5** — _As any user, I want to reset my password via email if I
  forget it._
- **US6** — _As a new user, I want my email verified before I can take
  sensitive actions (invite, upload)._
- **US7** — _As any user, I want a persistent session so I don't have
  to log in every page load, but one that expires safely._
- **US8** — _As any user, I want to log out on demand and have the
  session actually terminated server-side._
- **US9** — _As an owner with a lost MFA device, I want recovery codes
  so I'm not locked out of my own org._
- **US10** — _As a compliance reviewer, I want every auth event to be
  logged so anomalies and incidents can be investigated later._
- **US11** — _As an owner or admin, I want to suspend a user (internal
  or external) so they lose access immediately without me having to
  delete their account or break the audit trail._

## Functional requirements

### Identity & org model

- **FR1** — The system shall allow self-serve org creation via a signup
  flow that captures org name, owner email, owner full name, and
  password.
- **FR2** — User email addresses shall be globally unique across the
  system; a single email maps to a single user identity.
- **FR3** — At v0.1, every user belongs to exactly one org (internal
  roles) OR to zero orgs with Opportunity-scoped access (external role).
  Multi-org membership is out of scope.

### Email verification

- **FR4** — The system shall send an email-verification link on signup;
  the link shall be single-use, cryptographically unguessable, and
  valid for 24 hours.
- **FR5** — Users with unverified email shall be blocked from inviting
  others and from uploading documents. Login itself is allowed, so they
  can re-trigger verification.

### Invitations

- **FR6** — Owners and admins shall be able to invite internal users
  (`admin`, `internal`) by email, pre-assigning a role.
- **FR7** — Owners and admins shall be able to invite `external` users
  scoped to a specific Opportunity subroom. The scope shall be persisted
  with the invite; enforcement happens in the `access-control` slice.
- **FR8** — Invite links shall be single-use, cryptographically
  unguessable, and expire 7 days after issuance. Expired invites require
  re-invitation.
- **FR9** — On invite acceptance, the system shall require the recipient
  to set a password and verify their email in the same flow (implicit
  verification — the fact they clicked the invite link confirms email
  ownership).
- **FR10** — The inviter shall be able to revoke an unaccepted invite
  before it is accepted.

### Authentication

- **FR11** — Users shall authenticate via email + password. Successful
  password auth that requires MFA shall transition to an MFA challenge
  step before a session is issued.
- **FR12** — The system shall issue a session on successful auth
  (password + MFA). Session expiry rules, aligned with NIST SP 800-63B
  AAL2 as the fintech-grade baseline:
  - Internal (`owner`/`admin`/`internal`): inactivity timeout 30
    minutes; absolute lifetime 12 hours.
  - External (`external`): inactivity timeout 15 minutes; absolute
    lifetime 8 hours.
    Values are hardcoded at v0.1; per-org overrides are a later-slice
    concern.
- **FR13** — The system shall provide a logout endpoint that
  invalidates the current session on the server.
- **FR14** — The system shall expose a "current user" endpoint
  returning: user id, email, full name, role, org id (if any), org
  name (if any), MFA enrolment status, email verification status.

### MFA

- **FR15** — The system shall support TOTP-based MFA at v0.1.
- **FR16** — MFA shall be mandatory for all user roles at v0.1
  (`owner`, `admin`, `internal`, `external`). No opt-out.
- **FR17** — On MFA enrolment, the system shall issue 10 single-use
  recovery codes to the user. Codes shall be stored such that only
  their one-time use is verifiable, not their plaintext (hash or
  encrypt-at-rest with use-tracking). Users shall be able to:
  (a) view the codes once at the moment of enrolment,
  (b) **download the codes as a plain-text file** at enrolment, and
  (c) regenerate the code set at any time (invalidating prior codes).
  Post-enrolment, the plaintext codes shall never be retrievable from
  the system.
- **FR18** — Removing MFA shall require the user to re-authenticate
  with their current password and a current TOTP code (or recovery
  code). Role-based MFA requirements take precedence — a user with a
  role that mandates MFA cannot fully remove MFA while in that role.

### Password reset

- **FR19** — The system shall provide a password-reset flow triggered
  by email. Reset links shall be single-use, cryptographically
  unguessable, and expire 1 hour after issuance.
- **FR20** — A successful password reset shall invalidate all active
  sessions for that user.

### User suspension

- **FR21** — Owners and admins shall be able to suspend any user
  (internal or external) in their org. Suspension shall:
  (a) set the target user's lifecycle state to `suspended`,
  (b) terminate all active sessions for that user server-side,
  (c) reject future login attempts with a clear "account suspended"
  message,
  (d) be recorded as an audit event.
- **FR22** — Owners and admins shall be able to un-suspend any
  `suspended` user in their org, restoring login ability. Un-suspension
  shall be audit-logged.
- **FR23** — A user cannot suspend themselves. The sole `owner` of an
  org cannot be suspended; ownership must be transferred first
  (ownership transfer is out of scope for this slice but the constraint
  is enforced now).

### Audit trail

- **FR24** — The system shall record structured audit events for all
  of: signup, email verification, login success, login failure, MFA
  challenge issued, MFA success, MFA failure, logout, invite sent,
  invite accepted, invite revoked, invite expired, password reset
  requested, password reset completed, MFA enrolled, MFA removed,
  recovery-code-used, role changed, **user suspended, user
  un-suspended, user deleted**. Event retrieval UI is out of scope
  here; events must be queryable by user, by org, and by time range.

## Non-functional requirements

- **NFR1** — All authenticated endpoints require a valid session;
  unauthenticated requests return 401.
- **NFR2** — Passwords shall be hashed with a modern, industry-standard
  KDF. Plaintext passwords shall never be stored, logged, or transmitted
  beyond the initial TLS-terminated request.
- **NFR3** — All auth traffic shall be over TLS; non-TLS requests to
  auth endpoints shall be rejected.
- **NFR4** — Login attempts shall be rate-limited: no more than 10
  attempts per IP per minute, and no more than 5 per target email per
  minute. Repeated failures trigger exponential backoff.
- **NFR5** — Invite, verification, and reset links shall use
  cryptographically unguessable tokens (minimum 128 bits of entropy)
  and be single-use.
- **NFR6** — MFA TOTP seeds and recovery codes shall be encrypted at
  rest.
- **NFR7** — Session cookies (or equivalent tokens) shall be `HttpOnly`,
  `Secure`, `SameSite=Lax` or stricter, and signed against tampering.
- **NFR8** — Logging shall not include passwords, MFA codes, recovery
  codes, session tokens, reset tokens, or invite tokens. Email
  addresses may appear in audit events.
- **NFR9** — The data model shall support GDPR hard-delete of a single
  user without orphaning org data or audit continuity.
- **NFR10** — The architecture shall not preclude future SOC 2 /
  ISO 27001 scope — in particular, audit log immutability, key
  management, and access-change records must be feasible to enable
  later without re-architecting.
- **NFR11** — The system shall emit metrics sufficient to alert on
  anomalous auth patterns (spike in failed logins, spike in MFA
  failures, spike in invite-token abuse).

## Acceptance criteria

- **AC-US1** — A new user completes signup, receives a verification
  email, clicks the link, returns to the app authenticated, enrols MFA,
  and lands on a "you're logged in" state — end-to-end, no manual data
  patching required.
- **AC-US2** — An owner invites an admin. The admin receives the email,
  accepts, sets a password, is forced into MFA enrolment, and can log
  in with their admin role visible via the "current user" endpoint.
- **AC-US3** — An owner invites an external viewer scoped to
  `Opportunities/Vendor_A`. The invitee accepts, sets a password,
  enrols MFA (mandatory), logs in; the "current user" endpoint exposes
  the Opportunity scope even though enforcement is out-of-slice.
- **AC-US4** — No user of any role can complete login without MFA. MFA
  cannot be bypassed. Attempted bypass is an audit event.
- **AC-US5** — Password reset flow works end-to-end within 1 hour of
  request; reset links older than 1 hour return an explicit "link
  expired" error.
- **AC-US6** — A user whose email is not yet verified attempting to
  invite a colleague or upload a document receives a clear "verify
  email first" error and is not charged any side effect.
- **AC-US7** — A logged-in user remains logged in across browser
  restarts within the inactivity window; external-user sessions expire
  no later than 24 hours after issuance regardless of activity.
- **AC-US8** — After logout, the prior session token is invalid; using
  it returns 401; an audit event records the logout.
- **AC-US9** — Enrolling in MFA produces 10 recovery codes. The user
  can view them once AND download them as a text file in the enrolment
  flow. A recovery code authenticates once, is then unusable, and its
  use is recorded in the audit trail. Post-enrolment the plaintext
  codes cannot be retrieved by the user or support.
- **AC-US10** — Every event listed in FR24 appears in the audit store
  with at minimum: timestamp, actor user id (or null for
  pre-authentication events), target user id, org id (if any), event
  type, source IP, and outcome (success/failure). Querying by
  `(orgId, timeRange)` returns consistent results.
- **AC-US11** — An owner or admin suspends an internal user: the
  target's active sessions are invalidated within 1 minute; subsequent
  login attempts return "account suspended"; audit trail contains both
  the suspension event and the session-invalidation side effects.
  Un-suspension restores login. The sole owner of an org cannot be
  suspended — attempting this returns a clear error.

## Non-goals (for this slice)

- Folder- or document-level permission enforcement (→ `access-control`).
- NDA acceptance gate (→ `access-control`).
- Audit log viewer UI (→ `admin-dashboard`).
- Admin UI for listing/editing users (→ `admin-dashboard`).
- SSO / SAML / OIDC — Phase 2.
- WebAuthn / passkeys / hardware tokens — Phase 2.
- SMS or voice MFA — not planned (insecure).
- Multi-org membership for a single user — Phase 2.
- Self-serve org deletion — support-only at v0.1.
- Plan-based user limits / seat counting — lives in `billing-subscription`.
- Social login (Google/Apple/Microsoft) — Phase 2.

## Design-phase notes (intended choices — confirm in design.md)

- **Auth platform:** WorkOS (Bradley's preference, 2026-04-21). Gives
  us identity, org modelling, MFA, audit events, verification / invite /
  password-reset email delivery, and a clean path to SSO/SAML in Phase 2.
  Requirements stay provider-agnostic so we can pivot if WorkOS is a
  bad fit.
- **Transactional email for auth flows:** handled by WorkOS (AuthKit
  hosted flows). No separate transactional email provider needed for
  this slice.
- **Product-level email** (checklist reminders, access notifications,
  Phase-2 features) is not in scope for this slice. Provider choice
  (likely AWS SES when needed, to match SST stack) deferred to the
  slice that introduces it.

## Open questions

_(all v0.1 open questions resolved by Bradley on 2026-04-21)_

- ~~External viewers MFA-required vs. optional~~ → **required**.
- ~~Internal session lifetime~~ → **NIST AAL2 baseline** (30-min
  inactivity, 12-hour absolute).
- ~~Email provider~~ → **WorkOS handles auth email end-to-end**; no
  separate provider needed for this slice.
- ~~Recovery codes show-once vs. downloadable~~ → **downloadable**.
- ~~Suspended-user state vs. just delete~~ → **yes, suspended state added
  as an explicit lifecycle state**.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
