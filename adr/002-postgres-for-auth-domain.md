# ADR-002 — Postgres (PlanetScale) + Drizzle for the ai-data-room domain

- **Status:** accepted
- **Date:** 2026-04-22
- **Deciders:** Bradley Simms-Evans (Owner / CTO)
- **Related:** `specs/ai-data-room/auth-and-orgs/design.md`,
  `specs/ai-data-room/room-and-folders/design.md`,
  `specs/ai-data-room/ai-search-qna/design.md` (pgvector),
  `memory/tech-stack.md`, ADR-001 (WorkOS)

## Context

The `auth-and-orgs` slice is the first to need a persistent store, but
eight other slices (`room-and-folders`, `access-control`,
`doc-checklist`, `ai-doc-sensecheck`, `ai-search-qna`,
`admin-dashboard`, `billing-subscription`, `onboarding-flow`) all land
their canonical state into the same database. The shape of that state
is:

- **Highly relational.** Organizations ↔ memberships ↔ users ↔
  invitations ↔ Opportunities ↔ grants ↔ folders ↔ slots ↔
  slot_instances ↔ document_versions ↔ audit_events ↔
  subscriptions ↔ onboarding_progress. Every slice's design document
  uses foreign keys, joins, and compound indexes.
- **Query-pattern diverse.** Audit rows are queried by
  `(org_id, occurred_at desc)`, slot completion by folder, invitations
  by state + expiry, billing by org, Q&A retrieval by vector similarity
  within an access-filtered passage set, etc. There is no single
  partition key that would serve all of these well.
- **Audit-first.** `audit_events` needs secondary indexes on
  `actor_user_id`, `target_user_id`, `event_type` with time-range
  scans. This is a textbook relational-DB workload and a weak fit for
  a key-value store.
- **Vector-search-adjacent.** Slice 6 (`ai-search-qna`) embeds passages
  and stores them in `qna_passages(vector(1024))` with an HNSW index.
  Postgres + `pgvector` keeps retrieval in-VPC with the same
  access-control filters — a huge operational win compared with an
  external vector database.
- **Multi-tenant.** Every domain table carries `org_id`. Row-level
  filtering is enforced at the repository layer today and can be
  promoted to Postgres RLS when SOC 2 scope arrives, without a data
  migration.
- **Typed end-to-end.** Bradley's stack is TypeScript-first. Schema
  definitions need to produce types the application layer can import.

Bradley's existing production stack (`funds-distribution-platform` at
Capital Pay) already uses **Drizzle + Postgres + `drizzle-kit`
migrations** under SST v4, with the same layered architecture pattern
we want for ai-data-room. The pattern is proven and transferable.

## Decision

Use **Postgres as the canonical domain database**, via **PlanetScale
Postgres** (managed) for v0.1, with **Drizzle ORM** for schema
definition and type-safe queries and **`drizzle-kit`** for migration
generation and introspection.

Concretely:

- **One logical database per environment** (`dev`, `staging`, `prod`).
  Branch-per-PR for schema review in `staging`.
- **Schema lives in `packages/db/schema/`**, one module per slice
  (`auth.ts`, `rooms.ts`, `access-control.ts`, `checklist.ts`,
  `sensecheck.ts`, `qna.ts`, `billing.ts`, `onboarding.ts`).
- **Migrations generated via `drizzle-kit generate`**, checked into
  `packages/db/migrations/`, applied via `drizzle-kit migrate` in the
  deploy pipeline. No hand-written SQL migrations except for pgvector
  extension creation and any Postgres-specific DDL (RLS, triggers,
  partial indexes) that Drizzle's generator won't emit cleanly.
- **`pgvector` extension enabled** (required by slice 6). PlanetScale
  Postgres supports it.
- **Connections via a pooled driver** (`postgres.js` in transaction
  mode for Drizzle; or PlanetScale's own driver if it beats `pg` on
  latency — decide at scaffold time).
- **No domain state outside Postgres** for v0.1, with the following
  approved exceptions:
  - **S3**: document bytes (`room-and-folders`) — Postgres holds
    metadata only.
  - **DynamoDB**: intentionally **not used** in v0.1. Revisit when a
    real KV/high-throughput workload shows up (e.g. if realtime
    presence or WebSocket fanout lands in Phase 2).
  - **In-memory LRU caches**: per-process only (session cache,
    enforcement cache) — not a system of record.
  - **SQS/EventBridge**: message bus only, not state.

### Drizzle conventions

- Use `uuid` primary keys via `gen_random_uuid()`; never rely on
  application-generated ids for audit-critical tables.
- `timestamptz` everywhere — no naked `timestamp`.
- Enum columns use Postgres-native enum types (not text + CHECK) so
  they show up correctly in introspection + are migration-safe.
- `created_at` / `updated_at` on every table; `updated_at` maintained
  by an app-level repo helper rather than a trigger at v0.1 (review
  on SOC 2 entry).
- Repositories live under
  `microservices/core/infrastructure/db/<slice>/` and expose typed
  methods; no raw Drizzle queries escape past the infrastructure
  layer.

## Alternatives considered

### Option A — Postgres + Drizzle on PlanetScale ✅ chosen

- ✅ Matches FDP (Bradley's most production-mature repo); pattern
  transferable.
- ✅ Relational model fits the access pattern natively; audit queries,
  joins, and compound indexes are free.
- ✅ `pgvector` keeps slice 6 in-VPC — no external vector DB.
- ✅ Drizzle gives us typed schema + typed queries without Prisma's
  query-engine runtime overhead.
- ✅ `drizzle-kit introspect` + checked-in migrations give a clean
  audit trail of schema change.
- ✅ PlanetScale Postgres = managed HA + branching + point-in-time
  restore without paying the RDS ops tax.
- ❌ PlanetScale Postgres is newer than their MySQL product; mitigated
  by the contract being pure Postgres (swap to RDS / Neon / Supabase
  is a connection-string change + migration replay).

### Option B — Postgres + Prisma

- ✅ Best-in-class DX for migrations and schema UX.
- ❌ Prisma query engine is an extra runtime process / FFI boundary
  that Drizzle avoids; matters at cold-start on Lambda.
- ❌ FDP is on Drizzle — introducing Prisma would fork the pattern for
  no product benefit.
- ❌ Prisma's raw-SQL escape hatch is clumsier than Drizzle's when we
  need a Postgres-specific feature (partial unique indexes, RLS,
  `pgvector` ops).

### Option C — DynamoDB (single-table design)

- ✅ Near-zero ops. Per-request billing. Scales horizontally without
  thought.
- ❌ Every access pattern we actually need requires a GSI; the
  secondary-index cost blows up quickly.
- ❌ Audit queries by `(org_id, occurred_at desc)` plus
  `(actor_user_id, occurred_at desc)` plus `(event_type,
occurred_at desc)` would force 3 GSIs with duplicated data.
- ❌ Joins are an application-layer concern — turns every multi-slice
  read into a fan-out.
- ❌ No `pgvector`-equivalent; slice 6 would need OpenSearch or
  Pinecone, adding a vendor and taking retrieval out of VPC.
- ❌ SOC 2 audit evidence on a denormalised single-table design is
  materially harder to explain than on a normalised relational
  schema.

DynamoDB remains the right call for specific future workloads (realtime
presence, high-throughput KV, ephemeral session state), per
`memory/tech-stack.md`. Not for the canonical domain.

### Option D — RDS Postgres (Aurora Serverless v2) + Drizzle

- ✅ Same Postgres + Drizzle story as Option A; different ops profile.
- ✅ AWS-native, fits the SST v4 mental model cleanly.
- ❌ Higher ops cost than PlanetScale at our scale (idle cost, manual
  branching, no native PR-branch DB).
- ❌ Cold-start on Aurora Serverless v2 is real; annoying at dev time.

Easy supersede target if PlanetScale Postgres turns out to be immature
for our workload. Connection-string-level swap.

### Option E — Supabase (Postgres + Auth + Storage)

- ✅ Integrated offering; fast to prototype.
- ❌ We've already committed to SST v4 + AWS for infra and WorkOS for
  auth (ADR-001). Supabase would duplicate Auth + Storage.
- ❌ Pulls us toward Supabase for everything; creates a second primary
  vendor alongside WorkOS.

### Option F — SQLite (Cloudflare D1 / Turso)

- ✅ Great DX; edge-native; cheap at low scale.
- ❌ No `pgvector`. Slice 6 would need another store.
- ❌ Concurrent-write model is a liability for an audit-heavy
  workload.
- ❌ Not in Bradley's stack; no FDP dividend.

## Consequences

### Positive

- **Single database for the whole domain** simplifies the mental
  model, cross-slice joins (e.g. admin dashboard aggregates), and
  migration review.
- **Vector search without a new vendor** — slice 6 stays in-VPC with
  the same access-control filters the rest of the app uses, which is
  itself a security win (see `ai-search-qna/design.md` on the double
  access-control filter).
- **FDP-pattern dividend** — Drizzle conventions, migration workflow,
  repository pattern, test harness: all copyable from FDP.
- **SOC 2-ready foundations** — normalised audit table, enum columns,
  append-only-by-convention, RLS-ready column shape. No data
  migration required to tighten later.
- **Type-safety end to end** — Drizzle types flow into domain zod
  schemas, into API handlers, into the web package.

### Negative

- **PlanetScale Postgres is newer** than their MySQL offering.
  Mitigation: keep the contract pure Postgres; validate their HA
  posture on the pre-launch checklist; keep RDS Aurora as a known-good
  fallback.
- **Schema rigidity vs. DynamoDB.** Every new field needs a migration.
  Mitigation: Drizzle migrations are trivially generated; migration
  review in PR is a healthier process than silent schema drift.
- **Connection-pool management on Lambda.** Mitigation: use the
  RDS-proxy-style pooling PlanetScale exposes, or `postgres.js` with
  a small pool and `max_lifetime` under Lambda's idle timeout; measure
  in staging.
- **Single-DB blast radius.** A bad migration affects every slice.
  Mitigation: staging-first migration run with the exact prod
  migration file; PR-branch DBs for schema review; rollback scripts
  checked in alongside migrations.

### Follow-ups / work items

- On SOC 2 scope entry: promote repository-layer `org_id` filtering to
  Postgres RLS; field-encrypt PII columns (`users.email`,
  `users.full_name`) via KMS envelope.
- On scaffold: decide connection driver (`postgres.js` vs. PlanetScale
  native driver) by benchmarking p50/p95 at cold-start; record the
  call in a brief addendum.
- Schedule a pre-GA review of PlanetScale Postgres HA posture (v0.1
  blocker if it hasn't firmed up by the time we have paying
  customers).
- When Phase 2 adds a realtime surface (WebSocket presence, document
  collaboration, etc.), revisit whether DynamoDB or Redis enters the
  stack alongside Postgres — not as a replacement.

## References

- Spec: `specs/ai-data-room/auth-and-orgs/design.md` §Data model.
- Spec: `specs/ai-data-room/ai-search-qna/design.md` §Data model
  (pgvector + HNSW).
- Memory: `memory/tech-stack.md` (Postgres for relational, DynamoDB
  for KV).
- Precedent: `funds-distribution-platform` — Drizzle + Postgres +
  `drizzle-kit` in production.
- PlanetScale Postgres: <https://planetscale.com/postgres>
- Drizzle ORM: <https://orm.drizzle.team>
- pgvector: <https://github.com/pgvector/pgvector>
