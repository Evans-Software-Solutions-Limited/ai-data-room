# Requirements — ai-data-room / access-control

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-04-21
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `auth-and-orgs`, `room-and-folders`

## Context

`auth-and-orgs` gave us identity + role + Opportunity scope on an
external grant. `room-and-folders` gave us folders and documents. This
slice is the **enforcement and grant-management layer** between them:
it decides who can see / download / upload / manage what, and it handles
the lifecycle of external access (invite → NDA acceptance → time-boxed
viewing → revocation / expiry). This is the slice that makes the product
safe to send to a real external party.

## Users & roles

- **Primary user:** owner/admin issuing, monitoring, and revoking
  external access grants.
- **Secondary users:** external viewers accepting NDAs and viewing
  documents; internal users whose folder visibility is governed by this
  slice.
- **Roles:** as defined in `auth-and-orgs` — `owner`, `admin`,
  `internal`, `external`.

## User stories

- **US1** — _As an owner/admin, I want to invite an external viewer
  scoped to a specific Opportunity subroom, with an expiry date, so
  access is time-boxed by default._
- **US2** — _As an owner/admin, I want to choose a permission tier
  (view-only vs. view+download) when I invite an external viewer so I
  can gate sensitive material._
- **US3** — _As an owner/admin, I want external viewers to accept an
  NDA before they can see any document so we have a paper trail._
- **US4** — _As an owner/admin, I want to revoke an external viewer's
  access instantly from a management screen._
- **US5** — _As an owner/admin, I want to extend or shorten the expiry
  of an existing grant without re-inviting._
- **US6** — _As an owner/admin, I want access to expire automatically
  on the configured date without manual intervention._
- **US7** — _As an external viewer, I want to see clearly which
  documents I have access to and which I don't (rather than
  mysteriously-absent items)._
- **US8** — _As an internal user, I want `internal`-role colleagues to
  see all canonical folders by default so internal collaboration is
  frictionless._
- **US9** — _As a compliance reviewer, I want every access decision
  (allow/deny) and every document view/download to be audited._

## Functional requirements

### Grant model

- **FR1** — An **access grant** associates one user with one
  resource-scope and one permission tier. Resource-scope is either:
  - the whole org (internal users, implicit from their membership), or
  - a single Opportunity subroom (external users).
    Folder-level grants (e.g. "external user can see only `02_Financials`")
    are **not in scope** at v0.1; the Opportunity subroom is the unit of
    external access.
- **FR2** — Permission tiers at v0.1:
  - `viewer` — can list + open preview, cannot download.
  - `downloader` — `viewer` + can download the original file via
    pre-signed URL.
  - `contributor` (internal-only) — `downloader` + can upload.
  - `manager` (owner/admin) — `contributor` + can invite/revoke + edit
    folder metadata.
- **FR3** — External grants shall always have an `expires_at`
  timestamp. Default expiry **30 days** from issuance; configurable
  per-grant within a **1 day – 180 day** range at issuance time.

### External-user invite lifecycle

- **FR4** — An owner/admin shall be able to invite an external user by
  email to a specific Opportunity subroom with: permission tier
  (`viewer` or `downloader`), `expires_at`, and an optional message.
  The invite record integrates with the `invitations` table from
  `auth-and-orgs`.
- **FR5** — On invite acceptance, the system shall require the invitee
  to **accept the NDA** (see FR7) **before** being granted access.
  Until accepted, `/me` reflects the grant as `pending_nda`.
- **FR6** — An owner/admin shall be able to revoke a grant at any
  time. Revocation shall:
  - immediately hide all scoped resources from the external user,
  - invalidate any outstanding pre-signed download URLs (see FR12),
  - terminate any active sessions for that user scoped to the org,
  - be audit-logged.
- **FR7** — Each org shall have a single **NDA template** (plaintext
  or markdown at v0.1, uploaded by an admin). External users must
  accept the org's current NDA once per Opportunity invite. Admins
  can replace the NDA template; existing accepted grants are
  unaffected; new invites reference the new template.
- **FR8** — Expired grants shall be transitioned to state `expired`
  by a scheduled job no later than 15 minutes after their
  `expires_at`. Expired grants behave identically to revoked from the
  user's perspective, and the transition is audit-logged.

### Internal-user visibility

- **FR9** — Users with an `org_memberships` row in an org shall have
  implicit visibility to all six canonical folders and all
  `Opportunities/` subrooms in that org, subject to the permission
  tier rules in FR2 (e.g. `internal` role maps to `contributor`
  tier for canonical folders).
- **FR10** — An owner/admin shall be able to **exclude** a specific
  internal user from a specific Opportunity subroom (targeted
  exception). External inclusion into canonical folders is not
  supported at v0.1.

### Enforcement

- **FR11** — All endpoints that expose folder/document data from
  `room-and-folders` shall call the access-control enforcement layer
  on every request. Denials return 403; absence-as-denial (returning
  "not found" instead of "forbidden") is the default for external
  users to avoid leaking the existence of other resources.
- **FR12** — Pre-signed download URLs (`room-and-folders` FR16) shall
  include the grant id they were issued under. A backend pre-check
  on the URL's serve path re-validates the grant is still active;
  revocation invalidates outstanding URLs within 60 seconds.

### Auditing

- **FR13** — Every allow/deny decision shall be audit-logged with:
  actor user id, target resource (folder path or document id),
  permission requested (`view`/`download`/`upload`), outcome, and
  the grant id that authorised it (or null for denials).
- **FR14** — Every successful document **view** and **download** shall
  be audit-logged in addition to the allow/deny event, enabling
  external-viewer activity reports.
- **FR15** — The system shall emit an event when an NDA is accepted,
  recording: grant id, template id, template sha-256, accepted-at,
  accepting user id, source IP.

### Admin operations

- **FR16** — Owners/admins shall be able to list all active grants in
  their org with filters: by Opportunity, by status
  (`pending_nda`/`active`/`revoked`/`expired`), by expiring-soon
  (within N days). UI lives in `admin-dashboard`; this slice exposes
  the API.

## Non-functional requirements

- **NFR1** — Enforcement checks shall add ≤20ms p95 to any authed
  request they gate.
- **NFR2** — Access-denied responses shall never leak the existence
  of a resource the requester cannot see (including version history,
  audit metadata, or filename).
- **NFR3** — The expiry scheduler shall be idempotent — a grant that
  already transitioned to `expired` shall not be re-processed.
- **NFR4** — The grant model shall be extensible to folder-level
  scoping without a schema break (forward-compat with a Phase-2
  "bank-only folder in Opportunity X" pattern).
- **NFR5** — NDA templates shall be immutable once referenced by an
  accepted grant; edits create a new template version.
- **NFR6** — Access grant changes (issuance, revocation, expiry)
  shall be visible to the external user on their next request within
  60 seconds.
- **NFR7** — The audit log of access decisions shall be queryable for
  at least the last 90 days with p95 query latency ≤1 second.

## Acceptance criteria

- **AC-US1** — An owner invites an external viewer scoped to
  `Opportunities/Vendor_A` with `expires_at = now + 14d`. The
  invitee completes signup (via `auth-and-orgs`), accepts the NDA,
  and can list files in `Vendor_A`.
- **AC-US2** — The same external viewer, granted `viewer` tier, can
  preview files but receives 403 on any download attempt. Re-inviting
  (or editing the grant — if we expose edit) with `downloader` tier
  allows downloads.
- **AC-US3** — An invited external user who has not yet accepted the
  NDA sees an NDA acceptance screen, not the document list. On
  acceptance, they transition immediately to the document list.
- **AC-US4** — An owner revokes an active grant. The external user's
  next request within 60s returns "access denied"; outstanding
  pre-signed URLs return 403; audit trail records the revocation and
  the failed download attempts.
- **AC-US5** — An owner extends an existing grant's expiry from 7 days
  to 30 days; the external user retains access without re-accepting
  the NDA.
- **AC-US6** — A grant with `expires_at` in the past is automatically
  transitioned to `expired` within 15 minutes; the user's listing
  shows "access expired"; the state is audit-logged.
- **AC-US7** — An external viewer's document listing shows exactly
  the files in their Opportunity subroom and no indicator that other
  folders exist.
- **AC-US8** — Two internal users in the same org can both see all
  six canonical folders and all Opportunities in the default
  configuration, with `contributor` tier permissions.
- **AC-US9** — Every allow, deny, view, and download maps to an audit
  event; querying `(orgId, timeRange, externalUserId)` returns a
  complete activity trail for a given external viewer.

## Non-goals (for this slice)

- Folder- or document-level grants for external users → Phase 2.
- External users uploading documents → Phase 2 (`external-upload`).
- NDA as PDF / DocuSign integration → Phase 2.
- IP allow-listing for external grants → Phase 2.
- Device-restricted access → Phase 2.
- Watermarking / DRM on preview → Phase 2 (`watermark-preview-drm`).
- "Request access" flow from an external user who stumbles on a URL
  → Phase 2 (`request-intercept-hitl`).
- Learned approve/reject (AI-assisted grant recommendations) →
  Phase 2 (`learned-approve-reject`).

## Open questions

- Do we offer the `viewer` tier at MVP, or ship with `downloader`
  only and add `viewer` later once we have watermarked preview?
  Leaning **ship both** — `viewer` is the safer default for sensitive
  subrooms and is feasible without watermarking by restricting
  downloads server-side.
- NDA: support markdown or plaintext only at v0.1? Leaning
  **plaintext + a few styled fields** (company name, counterparty
  name, effective date) — avoids rendering-edge-case bugs.
- Should an `internal`-user targeted exclusion (FR10) notify the
  excluded user? Leaning **no** — exclusions are intentionally
  invisible to preserve confidentiality of sensitive Opportunities.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
