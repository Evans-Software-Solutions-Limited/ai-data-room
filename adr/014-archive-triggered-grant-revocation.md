# ADR-014: Archive-triggered external-grant revocation belongs to room-and-folders

- **Status:** proposed
- **Date:** 2026-07-16
- **Deciders:** Bradley (+ Claude, room-and-folders T-006)
- **Related:** [room-and-folders design](../.kiro/specs/ai-data-room/room-and-folders/design.md) (T-006, FR6, AC-US3), [ADR-011 multi-tenant isolation](011-multi-tenant-isolation.md), access-control slice (slice 3, not yet shipped)

## Context

FR6 requires that archiving an Opportunity subroom **revokes all its related
external access grants**, and T-006's tests-required line and AC-US3 both
assert grants are actually revoked on archive. The room-and-folders
`design.md` describes this as "archive → revoke-external-grants **via
access-control** (cross-slice call; import from access-control application
layer)".

That instruction cannot be followed as written, because of the run order:

- The canonical backlog runs **slice 2 (room-and-folders) before slice 3
  (access-control)** (`.kiro/specs/ai-data-room/README.md`).
- So at the time T-006 ships, there is no access-control application layer to
  import a revocation function from.
- `ExternalGrantRepo` (slice 1) deliberately exposes only create + read, with
  a header note reserving "revocation" for the access-control slice.

We need a boundary that lets T-006 satisfy FR6 now, without pre-empting the
richer access-control revocation surface (expiry transitions, the standalone
revocation API, access-time re-validation) that slice 3 will own.

## Decision

**room-and-folders owns _archive-triggered_ external-grant revocation;
access-control owns access-time enforcement, grant expiry, and the standalone
revocation API.**

Concretely: `archiveOpportunity` (T-006) revokes the archived subroom's active
grants in the same transaction as the archive, by calling a new scoped
`ExternalGrantRepo.revokeActiveForOpportunity(slug)` method (a
`WHERE org_id = $1 AND opportunity_slug = $2 AND status = 'active'` →
`status = 'revoked'` update). The revocation is an intrinsic consequence of the
room operation that triggers it, so it lives with that operation rather than
behind a cross-slice call into a slice that does not exist yet.

## Alternatives considered

- **A — Stub the cross-slice call now, wire the real one in slice 3.** Matches
  the design's literal wording, but leaves FR6/AC-US3 unmet until slice 3 —
  T-006's own tests would have to be weakened or deferred. Rejected: ships a
  security-relevant requirement as a no-op.
- **B — Introduce an `ExternalGrantRevoker` port + no-op stub + real slice-3
  adapter.** The full seam pattern (mirrors `OrgEventPublisher`). Rejected as
  over-engineering here: the scoped `externalGrants` repo is _already_ injected
  into the archive path via `ctx.scoped`, the revocation is a single scoped
  write, and no second implementation is anticipated — a port would abstract a
  dependency we fully own locally.
- **C (chosen) — room owns archive-triggered revocation via the scoped grant
  repo; access-control owns the rest.** Satisfies FR6 now, keeps the write on
  the tripwire-sanctioned repo, and draws a clean, durable boundary that
  slice 3 extends rather than contradicts.

## Consequences

- **Positive:** FR6/AC-US3 met in slice 2; revocation is transactional with
  archive (no partial state); the write stays inside the sanctioned scoped repo
  so the tenant tripwire and property test still govern it.
- **Negative / trade-offs:** a small deviation from the design's literal
  "via access-control" wording; `ExternalGrantRepo` gains a write method its
  slice-1 header reserved for slice 3 (header updated to reflect this split).
- **Follow-ups / obligations:** when access-control (slice 3) lands, it should
  (a) add its user-facing / API-driven revocation on top of the same repo
  method, and (b) own access-time enforcement + expiry — NOT re-implement
  archive-triggered revocation. Revisit this ADR's boundary if slice 3's design
  wants archive to emit an event that access-control subscribes to instead.
- **Known residual (slug is a mutable join key):** grants reference the
  subroom by `external_access_grants.opportunity_slug`, not by an
  `opportunity_id` FK (a slice-1 shape — see the note in `auth-orgs.ts`).
  T-006 keeps the slug consistent by re-keying grants inside
  `renameOpportunity` (`ExternalGrantRepo.retargetOpportunitySlug`), which
  closes the archive-after-rename hole for grants that already exist at rename
  time. One narrower edge remains: an invite created while the slug was `X`,
  accepted _after_ the subroom was renamed to `Y`, produces a grant keyed on
  the stale `X`. The durable fix is an `opportunity_id` FK on
  `external_access_grants` (resolve at grant creation; revoke/enforce by id),
  which access-control (slice 3) should adopt when it builds the real grant
  model. This is temporally safe until then: grant _enforcement_ itself does
  not ship until slice 3. **Now scoped** in the access-control spec:
  `access-control/tasks.md` T-001 (add the `opportunity_id` FK + backfill +
  remove room-and-folders' slug coupling, incl. deleting
  `retargetOpportunitySlug`) and T-007 (stamp + revoke by `opportunity_id`),
  with the design's §"`opportunity_slug` → `opportunity_id` FK" noting the
  invitation-carries-id follow-on needed to fully close the
  invite-accept-after-rename edge.

## References

- room-and-folders design.md §Interfaces, §Boundary with earlier slices
- requirements.md FR6, AC-US3
- ADR-011 (application-layer tenant isolation — why the revoke must go through a
  scoped repo)
