# ADR-012: Role vocabulary — adopt owner / editor / viewer / external

- **Status:** proposed
- **Date:** 2026-05-31
- **Deciders:** Bradley
- **Related:** [auth-and-orgs spec](../.kiro/specs/ai-data-room/auth-and-orgs/requirements.md) ·
  [access-control spec](../.kiro/specs/ai-data-room/access-control/requirements.md) ·
  design RBAC `docs/design/prototypes/datum-room/identity.js` ·
  [production-readiness](../docs/product/production-readiness.md) (RB-7)

## Context

`auth-and-orgs` shipped (slice 1, tag `v0.1.0-auth-and-orgs`) with a role enum
of **`owner` / `admin` / `internal`** (plus `external` for the non-membership
path). The verified design prototype (`datum/room`) defines its RBAC in
`identity.js` as **`owner` / `editor` / `viewer` / `external`**, with capability
flags (editor = full room + upload + AI-admin, no manage-access; viewer =
internal read + download + audit). The UI will be built against the design's
vocabulary; the backend currently uses different names for the same roles. One
product, two names for the same thing is a recipe for bugs at the API boundary.

## Decision

**Adopt the design's role vocabulary — `owner` / `editor` / `viewer` /
`external` — as the single canonical role model across UI and backend.** Rename
the shipped DB enum and code: `admin` → `editor`, `internal` → `viewer`. The
specs have been updated to the new vocabulary; a migration closes the gap to the
shipped code.

The internal-vs-external **category** (`kind` on invitations/grants, "internal
users" as a group, the `ROLES[x].internal` flag) is unchanged — it is orthogonal
to the role name and still distinguishes membership users from
Opportunity-scoped external viewers.

## Alternatives considered

- **Option A — Keep `admin`/`internal` in the backend, map to `editor`/`viewer`
  only in the UI.** No migration. Cons: a permanent translation layer at every
  API boundary; the audit log, `/me`, and WorkOS metadata all keep the old
  names; new engineers meet two vocabularies. Drift risk forever.
- **Option B — Rename to the design vocabulary everywhere (chosen).** One name
  per role end to end. Cost: a DB enum migration + code/test refactor + WorkOS
  role-metadata update on existing records.
- **Option C — Change the design instead.** Rejected — the design is verified
  and `editor`/`viewer` are clearer to end users than `admin`/`internal`.

## Consequences

- **Positive:** one vocabulary across UI, API, audit log, and docs; clearer
  end-user labels; the design and backend agree.
- **Negative / trade-offs:** a migration against shipped data — the
  `org_memberships.role` and `invitations.role` enums, any WorkOS role metadata,
  repos, fixtures, and tests must all move together. `AuditEventTypeSchema` and
  historical audit rows referencing `admin`/`internal` need a backfill or a
  documented cutover.
- **Follow-ups / obligations:**
  - Migration task (RB-7): `ALTER TYPE` (or new enum + backfill) for
    `org_memberships.role` and `invitations.role`; update repos, guards
    (`authorizeOrgAccess`), `/me` shape, fixtures, and tests in one PR.
  - Update the `migrate.integration.test.ts` expectations.
  - Land before `access-control` (slice 3) builds role-tier logic, so it builds
    on the final names.

## References

- `identity.js` `ROLES` — the canonical capability model.
- ADR-001 (WorkOS) — role metadata lives partly in WorkOS; the rename touches it.
