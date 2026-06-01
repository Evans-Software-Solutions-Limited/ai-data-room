# ADR-012: Role vocabulary — adopt owner / editor / viewer / external

- **Status:** accepted (T-000 green, 2026-05-31)
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
- **Negative / trade-offs:** a migration touching the `org_memberships.role` and
  `invitations.role` enums, the canonical zod `RoleSchema` / `InvitationRoleSchema`
  in `packages/api-utils`, repos, guards, fixtures, and tests — all moving
  together. Role is **stored locally only** — there is no WorkOS-side role
  metadata to migrate (verified against the shipped WorkOS client, 2026-05-31).
  Historical audit rows: `event_type` is `text` (not the renamed enum) and any
  `role` value sits in free-form JSON `metadata`; with no production data
  pre-launch this is a no-op cutover, documented rather than backfilled.
- **Follow-ups / obligations:**
  - **Folded into `org-provisioning` as T-000** (RB-7) — the first build target,
    which already touches memberships/roles. Hand-authored `ALTER TYPE … RENAME
VALUE` (+ paired `.down.sql`) for `org_memberships.role` and
    `invitations.role`; update the canonical zod schemas, repos, guards
    (`authorizeOrgAccess` / `OWNER_ADMIN`), the `/me` role union, the invitation
    role guards + handler body schema, fixtures, and tests in one PR. ADR moves
    to `accepted` on T-000 green.
  - Add a value-level enum-label assertion to `migrate.integration.test.ts`
    (its current checks assert enum _names_ only, so a value rename is otherwise
    untested).
  - Lands before `access-control` (slice 3) builds role-tier logic, so it builds
    on the final names.

## References

- `identity.js` `ROLES` — the canonical capability model.
- ADR-001 (WorkOS) — auth platform. Role is stored locally, not in WorkOS, so
  the rename does not touch WorkOS metadata at v0.1.
