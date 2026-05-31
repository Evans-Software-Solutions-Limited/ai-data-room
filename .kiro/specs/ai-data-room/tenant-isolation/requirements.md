# Requirements — ai-data-room / tenant-isolation

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-05-31
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `auth-and-orgs`
**Prerequisite for:** `room-and-folders` (and every slice that persists or
reads tenant-scoped data)
**ADR:** [ADR-011](../../../adr/011-multi-tenant-isolation.md)

## Context

`auth-and-orgs` established the org (tenant) as the unit of tenancy, but
`CLAUDE.md` records that the product runs **single-tenant in practice** until
the org model is properly isolated and dogfooded. That is acceptable for an
auth-only shell. It stops being acceptable the moment `room-and-folders` stores
real customer documents: from then on, every read path — folder listings,
downloads, checklist state, sense-check results, Q&A retrieval — can return
another organisation's data if a single query predicate is wrong.

This slice makes cross-tenant isolation a **tested, enforced invariant** rather
than a convention. It is a cross-cutting hardening slice: it ships little
user-visible behaviour but is the load-bearing guarantee under a product whose
entire value proposition is confidentiality.

## Users & roles

- **Primary beneficiary:** every org (tenant) — the guarantee that no other
  tenant can ever read its rows.
- **Primary implementer audience:** engineers writing repositories in any
  later slice. The mechanism must make the *safe* path the *default* path.
- **Roles (from `auth-and-orgs`):** `owner`, `admin`, `internal`, `external`.
  Isolation is org-level and sits beneath role-level authorisation.

## User stories

- **US1** — _As an org, I want a hard guarantee that no query issued on behalf
  of another org can ever return my rows, even if application authorisation has
  a bug._
- **US2** — _As an engineer adding a repository in a future slice, I want the
  tenant-scoped query path to be the default so I cannot accidentally write an
  unscoped query._
- **US3** — _As a reviewer, I want an automated guard that fails CI if a
  tenant-scoped table is queried without a tenant predicate._
- **US4** — _As a security reviewer, I want a property test that actively tries
  to leak cross-tenant rows and proves it cannot._

## Functional requirements

### Tenant context

- **FR1** — A request-scoped **tenant context** carrying the caller's local
  `org_id` shall be derived from the authenticated actor (reusing
  `resolveActor` from `auth-and-orgs`) and made available to the data-access
  layer for the lifetime of the request.
- **FR2** — Operations with no tenant context (system jobs, webhooks, retention
  sweeps) shall use an explicit, audited "system" scope that names the
  org(s) it operates on — never an implicit "all orgs" default.

### Scoped data access

- **FR3** — Every repository touching a **tenant-scoped table** shall obtain
  its handle through a `scopedRepo(orgId)` factory (or equivalent) that injects
  the `org_id` predicate into every read and stamps it on every write. Direct
  construction of a tenant-scoped repository without an `org_id` shall not be
  possible from application code.
- **FR4** — A table is "tenant-scoped" if it carries (directly or via FK) an
  `org_id`. A canonical registry of tenant-scoped vs. tenant-agnostic tables
  (e.g. `webhook_deliveries`, plan catalogue) shall be maintained in code.
- **FR5** — Cross-org operations that are legitimately needed (e.g. admin
  platform metrics) shall go through a separate, explicitly-named API that
  does not reuse the tenant-scoped factory.

### Enforcement & backfill

- **FR6** — A lint / CI guard shall fail the build if a tenant-scoped table is
  referenced outside the `scopedRepo` factory (raw `db.select(...)` against a
  scoped table is a violation).
- **FR7** — The `auth-and-orgs` repositories that are already org-scoped shall
  be backfilled onto the factory so slice 1 and slice 2 share one mechanism.

### Audit

- **FR8** — A denied/empty cross-tenant access attempt that the guard catches
  at runtime (defence in depth) shall emit an audit event via the
  `auth-and-orgs` audit writer, tagged as a potential isolation violation.

## Non-functional requirements

- **NFR1** — **No cross-tenant leak.** No query issued under org A's context
  shall return any row whose effective `org_id ≠ A`. This is the single
  load-bearing invariant of the slice and shall be proven by a property test
  (FR-driven; see AC-US4).
- **NFR2** — The tenant guard shall add ≤2ms p95 overhead per query relative to
  an unscoped baseline.
- **NFR3** — The mechanism shall compose with the existing `withTx(tx)`
  transaction pattern (sequential awaits inside a single Postgres connection)
  without breaking it.
- **NFR4** — The mechanism shall compose with the `ai-search-qna` pgvector ANN
  query and its double access-filter (the SQL tenant predicate is the first of
  the two filters).
- **NFR5** — The architecture shall not preclude a later move to Postgres
  row-level security (RLS) as DB-enforced defence in depth (ADR-011 Option A).

## Acceptance criteria

- **AC-US1** — Given a seeded DB with two orgs each owning rows in every
  tenant-scoped table, every repository read under org A's context returns only
  org A's rows; org B's are never present.
- **AC-US2** — Attempting to construct a tenant-scoped repository without an
  `org_id` is a type error / runtime guard — it does not compile or it throws
  before any query runs.
- **AC-US3** — A deliberately-introduced raw unscoped query against a
  tenant-scoped table fails the lint/CI guard.
- **AC-US4** — A property-based test that generates random org pairs and random
  row distributions cannot produce a single cross-tenant row in any repository
  method; the test is wired into CI.
- **AC-US5** — All existing `auth-and-orgs` org-scoped repositories route
  through the factory; the slice-1 suite stays green.

## Non-goals (for this slice)

- Postgres RLS policies → deferred (ADR-011 Option A; revisit before SOC 2).
- Role-level / document-level authorisation → `access-control` (this slice is
  org-level isolation *beneath* role checks).
- Multi-region / data-residency partitioning → Phase 2.
- Per-tenant encryption keys → Phase 2 (compliance track).

## Open questions

- **Factory shape:** a `scopedRepo(orgId)` wrapper vs. a mandatory first
  argument on every repo method. Leaning wrapper — harder to forget, matches
  FDP. Resolve in design.
- **System-scope ergonomics:** how retention sweeps / webhook handlers express
  "operate on org X" without a request actor. Leaning an explicit
  `systemScope(orgId)` constructor with its own audit tag.
- **Lint mechanism:** custom ESLint rule vs. a grep-based CI tripwire (cf.
  `auth-and-orgs` NFR-matrix test). Leaning the tripwire for speed at v0.1.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
