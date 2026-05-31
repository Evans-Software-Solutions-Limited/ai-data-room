# Requirements — ai-data-room / org-provisioning

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-05-31
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `auth-and-orgs`
**Prerequisite for:** `tenant-isolation`, `room-and-folders` (everything that
attaches to an `org_id`)

## Context

`auth-and-orgs` shipped the org **data model** (orgs, memberships,
external_access_grants) but deliberately deferred org **provisioning** to the
slice-9 onboarding wizard — so `/me` returns `{ orgId: null }` and a user is
lazy-mirrored without a membership until the wizard lands. That leaves a gap:
`room-and-folders` (FR1) and `tenant-isolation` both assume an `org_id` already
exists, but nothing self-serve creates one before slice 9.

This slice pulls the **org-creation mechanism** forward out of `onboarding-flow`
so the rest of Phase 1 has a real org to attach to. It owns the create-org →
first-membership → canonical-room-provisioning path as an API + minimal flow;
`onboarding-flow` (slice 9) later wraps this mechanism in the full guided wizard
UX rather than owning it. Scope here is intentionally thin: make an org exist,
correctly, with the owner attached and the canonical room provisioned.

## Users & roles

- **Primary:** a newly-signed-up authenticated user with no org yet (the
  lazy-mirrored actor from `auth-and-orgs` with `orgId: null`).
- **Roles (from `auth-and-orgs`):** the creator becomes `owner` of the new org.

## User stories

- **US1** — _As a newly-signed-up user with no organisation, I want to create my
  organisation by giving it a name, so I can start using the product._
- **US2** — _As the creator, I want to automatically become the owner of the new
  org with a membership, so my `/me` resolves to a real `orgId` and role._
- **US3** — _As the creator, I want my canonical six-folder room provisioned
  automatically on org creation, so the room exists the moment the org does._
- **US4** — _As a user who already belongs to an org, I should not be able to
  create a second org at v0.1 (single-membership invariant from slice 1)._

## Functional requirements

- **FR1** — An authenticated user with no membership shall be able to create an
  organisation by supplying an org name (1–80 chars; uniqueness handled per the
  slice-1 org model — WorkOS org + local mirror).
- **FR2** — Org creation shall, in a single transaction (`withTx`, sticky #15):
  create the local `orgs` row (mirroring the WorkOS org id → local UUID per
  sticky #16), create the creator's `owner` membership, and emit the audit
  events.
- **FR3** — On successful org creation, the **canonical room shall be
  provisioned** — this slice fires the `org.created` event that
  `room-and-folders` consumes to create the six canonical folders (the room
  provisioning logic lives in `room-and-folders`; this slice owns the trigger).
- **FR4** — After creation, `/me` shall resolve to the new `{ orgId, role:
  'owner' }` (replacing the slice-1 `{ orgId: null }` lazy-mirror state).
- **FR5** — A user who already has a membership shall be rejected from creating
  another org (FR-aligned with the slice-1 max-one-membership invariant).
- **FR6** — Org creation shall emit audit events (`org.created`,
  `membership.created`) via the sanctioned writer.

## Non-functional requirements

- **NFR1** — Org creation shall be atomic: a partial failure (org row created
  but membership not) shall leave no half-provisioned state. The multi-write
  transaction is the guarantee.
- **NFR2** — The `org.created` → room-provisioning handoff shall be idempotent:
  a redelivered event shall not create duplicate canonical folders.
- **NFR3** — All created rows are tenant-scoped from birth (`tenant-isolation`
  applies the moment the org exists).
- **NFR4** — Org creation shall be rate-limited (reuse the slice-1 limiter) to
  prevent org-spam from a single actor.

## Acceptance criteria

- **AC-US1** — A signed-up user with `orgId: null` creates an org named
  "Acme Ltd"; the call succeeds and returns the new org.
- **AC-US2** — Immediately after, `/me` returns `{ orgId: <uuid>, role:
  'owner' }`.
- **AC-US3** — The canonical six-folder room exists for the new org (verified
  via `room-and-folders` listing) within seconds of creation.
- **AC-US4** — A user who already belongs to an org is rejected when attempting
  to create a second.
- **AC-US5** — A simulated mid-transaction failure leaves no orphan org row.
- **AC-US6** — `org.created` + `membership.created` audit events are recorded.

## Non-goals (for this slice)

- The full guided onboarding wizard (multi-step, sample room, activation
  metrics) → `onboarding-flow` (slice 9), which wraps this mechanism.
- Inviting teammates / first external viewer → `access-control` + the wizard.
- Org settings / rename / billing contact → `admin-dashboard` / `billing`.
- Multiple orgs per user → Phase 2 (slice-1 invariant is one membership).
- Org deletion → covered by `data-export` offboarding + `auth-and-orgs` GDPR.

## Open questions

- Should org creation be its own endpoint (`POST /orgs`) in `meRoutes` (no org
  context required yet — sticky #36) or part of a dedicated provisioning route?
  Leaning `POST /orgs` in `meRoutes` since the caller has no org context at
  creation time.
- Does WorkOS org creation happen here (we call `organizations.createOrg`) or do
  we only mirror an externally-created WorkOS org? Leaning: create the WorkOS
  org here so the flow is self-contained. Resolve in design.
- Canonical-room provisioning via event (chosen, FR3) vs. a direct call into
  `room-and-folders` — event keeps the dependency one-directional.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
