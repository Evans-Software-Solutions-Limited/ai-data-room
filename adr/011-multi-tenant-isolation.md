# ADR-011: Row-level multi-tenant isolation before document storage ships

- **Status:** accepted
- **Date:** 2026-05-31 (proposed) · 2026-07-16 (accepted)
- **Deciders:** Bradley (+ Curtis for vendor-workflow review)
- **Accepted:** on the green `tenant-isolation` slice (10) property test —
  `microservices/core/test/integration/db/tenantIsolation.property.integration.test.ts`
  (T-006, NFR1/AC-US4) proves no `scopedRepo(orgA)` read returns a foreign-org
  row over `fast-check`-generated distributions against real Postgres. The
  Option B mechanism (factory + registry + CI tripwire + property test) is
  shipped: T-002 factory, T-003 `systemScope`, T-004 backfill, T-005 tripwire,
  T-006 property test. Postgres RLS (Option A) remains the deferred SOC 2-track
  follow-up.
- **Related:** [brief](../docs/briefs/ai-data-room.md) ·
  [auth-and-orgs spec](../.kiro/specs/ai-data-room/auth-and-orgs/requirements.md) ·
  [room-and-folders spec](../.kiro/specs/ai-data-room/room-and-folders/requirements.md) ·
  [ADR-001 (WorkOS)](./001-workos-as-auth-platform.md) ·
  [production-readiness](../docs/product/production-readiness.md) ·
  FDP ADR-001 (multi-tenant row-level isolation)

> **Numbering note.** The `adr/README.md` "Flagged" list reserves ADR-003
> through ADR-010 for per-slice decisions, but ADR-003 was actually used for
> recovery-codes-delegated-to-authkit. The reservation block is therefore
> stale and needs renumbering. This ADR takes **011** to avoid colliding with
> the reserved (if drifted) 003–010 range.

## Context

`CLAUDE.md` records a deliberate choice: ai-data-room ships **single-tenant**
until "the org model lands properly in slice 1 and is dogfooded." That was a
reasonable call for slice 1, which delivers only an auth + identity shell with
no customer documents at rest.

That changes the moment slice 2 (`room-and-folders`) lands real document
storage. From then on, every read path — folder listing, document download,
checklist state, sense-check results, and especially the `ai-search-qna`
retrieval pipeline — can return another organisation's data if a single query
predicate is wrong. The `org_id` column exists throughout the schema and the
slice designs scope by it, but **scoping by convention is not isolation**: one
forgotten `WHERE org_id = $1` is a cross-tenant data breach in a product whose
entire value proposition is confidentiality.

FDP already solved this (FDP ADR-001) with row-level isolation. We deliberately
did not mirror it yet. This ADR forces the decision before document storage,
not after.

## Decision

**Adopt FDP-style row-level multi-tenant isolation, enforced at the data-access
layer, as a hard prerequisite for merging any slice-2 task that persists or
reads customer documents.**

Concretely: a query-time tenant guard that every repository touching
tenant-scoped tables must route through, plus a property-based test proving no
generated query can return rows for an `org_id` other than the caller's. This
sits underneath — not instead of — the application-layer cross-org checks
(e.g. `authorizeOrgAccess`) and the `ai-search-qna` double access-filter.

## Alternatives considered

- **Option A — Postgres RLS policies (DB-enforced).** Strongest guarantee;
  the database refuses cross-tenant rows even if app code is buggy. Cons:
  requires per-connection `SET app.current_org`, complicates the Drizzle +
  PlanetScale connection model and the transaction (`withTx`) pattern, and
  interacts awkwardly with the pgvector ANN query. Strong candidate for a
  later hardening pass.
- **Option B — Application-layer tenant guard + property tests (chosen).**
  A mandatory `scopedRepo(orgId)` factory (or equivalent) that injects the
  `org_id` predicate, plus invariant tests. Lower friction with the current
  stack, ships with slice 2, and is the same shape as FDP. Cons: enforced by
  discipline + tests, not by the database — a repo that bypasses the factory
  is a latent hole (mitigated by lint rule + the property test).
- **Option C — Stay single-tenant (one DB/schema per customer).** Hard
  isolation by physical separation. Cons: kills the SaaS economics and the
  admin/billing aggregates; a non-starter for the self-serve SME segment in
  the brief.

## Consequences

- **Positive:** closes the single largest production-readiness risk before any
  customer document exists; aligns with FDP so the pattern is already proven;
  gives a testable invariant rather than a hope.
- **Negative / trade-offs:** application-layer enforcement (Option B) is only
  as good as its coverage — needs a lint/CI guard against raw repo access and
  a property test that actually generates adversarial `org_id`s. Option A
  (RLS) remains the stronger long-term answer and should be revisited before
  SOC 2.
- **Follow-ups / obligations:**
  - Add a slice-2 task (`T-00x`) implementing the tenant guard + property test;
    make it blocking for every later slice-2 task that reads/writes documents.
  - Backfill the same guard onto the slice-1 repos that are org-scoped.
  - Re-evaluate Postgres RLS (Option A) as part of the SOC 2 track.

## References

- FDP ADR-001 — multi-tenant row-level isolation (prior art on the same stack).
- `ai-search-qna/design.md` §Security — double access-control filter (the
  retrieval-layer counterpart this ADR sits beneath).
- `docs/product/production-readiness.md` — release-blocker register.
