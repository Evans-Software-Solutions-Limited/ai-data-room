# ai-data-room — feature-sliced spec index

> Product brief: [`/briefs/ai-data-room.md`](../../briefs/ai-data-room.md)

Each feature slice is its own Kiro-style spec (`requirements.md` →
`design.md` → `tasks.md`). The slice is only "done" when the agent
executing `tasks.md` in the target repo has merged PRs that satisfy the
acceptance criteria in `requirements.md`.

**Rule:** no code until a slice's `requirements.md` is signed off by
Bradley. No tasks until its `design.md` is signed off. Each slice is
self-contained enough for a Claude Code agent to execute without
cross-session coordination.

## Slice order (dependency-correct)

| #   | Slice                  | Depends on | Status                        | Why it's first/later                                                                   |
| --- | ---------------------- | ---------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `auth-and-orgs`        | —          | reqs + design + tasks drafted | Foundation. Every other slice touches org tenancy + user identity.                     |
| 2   | `room-and-folders`     | 1          | reqs + design + tasks drafted | The canonical six-folder room + Opportunities subrooms. Upload/list/delete primitives. |
| 3   | `access-control`       | 1, 2       | reqs + design + tasks drafted | Date-expiring invites, revocable, tiered permissions, NDA gate, audit log.             |
| 4   | `doc-checklist`        | 2          | reqs + design + tasks drafted | Fixed per-folder checklist templates; drives self-service completion UX.               |
| 5   | `ai-doc-sensecheck`    | 2, 4       | reqs + design + tasks drafted | On-upload Claude classification vs. the slot's expected criteria.                      |
| 6   | `ai-search-qna`        | 2          | reqs + design + tasks drafted | Cited Q&A chat grounded in uploaded docs.                                              |
| 7   | `admin-dashboard`      | 1–6        | reqs + design + tasks drafted | Aggregates every earlier slice into the admin UX.                                      |
| 8   | `billing-subscription` | 1          | reqs + design + tasks drafted | Stripe. Can run in parallel with 2–6 once 1 is done.                                   |
| 9   | `onboarding-flow`      | 1–4, 17    | reqs + design + tasks drafted | Self-serve signup + first-room setup wizard. **Wraps slice 17's org-creation mechanism in guided UX — no longer owns provisioning.** |
| 10  | `tenant-isolation`     | 1          | reqs + design + tasks drafted | Cross-cutting hardening (ADR-011). **Must land before slice 2's document-bearing tasks.** Listed at 10 to avoid renumbering, but executes between 1 and 2. |
| 11  | `document-redaction`   | 2, 3 (+5 for AI-assist) | reqs + design + tasks drafted | Manual + AI-assisted redaction. Table-stakes vs. incumbents. |
| 12  | `document-viewer`      | 2, 3       | reqs + design + tasks drafted | Read-only in-app PDF/Office viewer. **Prerequisite for slice 11** (region drawing); enhances slice 6 (citation → source view). |
| 13  | `notifications`        | 1 (consumes 2–6 events) | reqs + design + tasks drafted | Product email + in-app notifications (digests, access alerts, NDA, flags). Leaf dependency — can land mid-stream. |
| 14  | `search-ocr`           | 2, 5       | reqs + design + tasks drafted | OCR (so scanned docs are usable) + keyword full-text search beside semantic Q&A. |
| 15  | `data-export`          | 1, 2       | reqs + design + tasks drafted | Per-org room export + GDPR portability + offboarding/purge lifecycle. |
| 16  | `virus-scanning`       | 2          | reqs + design + tasks drafted | Scan-on-upload + quarantine. Clean-gate every consumer. Land early in slice 2's life. |
| 17  | `org-provisioning`     | 1          | reqs + design + tasks drafted | Owner creates org → first membership → fires `org.created` so the canonical room provisions; flips `/me` from `orgId:null`. **Executes right after slice 1, before 10 + 2.** Pulled forward out of slice 9 (which now wraps it in UX). |

**Execution order ≠ index number.** The numbers are a stable index, not the run
order. True run order starts: **1 → 17 (org-provisioning) → 10 (tenant-isolation)
→ 2 (room-and-folders) → …**. See `docs/product/implementation-plan.md`.

**Parallelisation notes:**

- Slice 17 (`org-provisioning`) runs immediately after slice 1 — slices 2 and 10
  both need a real `org_id`, which nothing provisioned self-serve before this
  (slice 1 left `/me.orgId = null` until the slice-9 wizard; this pulls the
  mechanism forward).
- Once slice 1 is shipped, slices 2 and 8 can run in parallel.
- Slices 4/5/6 can run in parallel once slice 2 is shipped.
- Slices 7 and 9 are the "tie it together" slices — they should land last.
- Slice 10 (`tenant-isolation`) executes **between** slices 1 and 2 despite its
  index number — it gates slice 2's document storage (see ADR-011).
- Slice 11 (`document-redaction`) follows slice 2; its AI-assist half soft-
  depends on slice 5's extractor, and it needs slice 12's viewer.
- Slice 12 (`document-viewer`) lands with/just-before slice 11 and enhances 6.
- Slice 16 (`virus-scanning`) should land early in slice 2's life — its
  clean-gate touches the upload pipeline and the AI slices' indexing triggers.
- Slices 13 (`notifications`), 14 (`search-ocr`), 15 (`data-export`) are
  additive and can be scheduled flexibly once their dependencies exist.

**Showcase sequencing (demo value, within the dependency constraints).** To
stand up a demoable "upload → AI checks it → ask a cited question" loop fastest,
front-load: **2 (rooms) → 6 (cited Q&A, the hero) → 5 (sense-check) → 4
(checklist)**, then 8/7/9 trail. The full ordered backlog (the thing to
hand to Claude Code) lives in
[`docs/product/implementation-plan.md`](../../../docs/product/implementation-plan.md);
the production-readiness blockers that gate it live in
[`docs/product/production-readiness.md`](../../../docs/product/production-readiness.md).
Strategic north star (why we win vs. incumbents) lives in
[`docs/product/positioning.md`](../../../docs/product/positioning.md).

## Repo layout convention (once scaffolded)

Scaffolded from `~/Documents/projects/personal/sst-monorepo-template`.
Target repo: TBD (Bradley to confirm path + GitHub org — likely
`Evans-Software-Solutions-Limited/ai-data-room`). Each slice corresponds
to a feature folder / workspace inside the monorepo, not a separate repo.

## Additions from the 2026 competitive scan + seam review (spec-complete, pending sign-off)

All eight new slices have full `requirements.md` + `design.md` + `tasks.md`.

- **`org-provisioning`** (17) — pulled forward out of slice 9 so a real `org_id`
  exists before slices 2/10. Owner-creates-org → first membership → `org.created`
  → canonical room provisions. Slice 9 now wraps it in UX.
- **`tenant-isolation`** (10) — row-level cross-tenant isolation as a tested
  invariant (ADR-011). Gates slice 2's document storage.
- **`document-redaction`** (11) — manual + AI-assisted redaction; table-stakes
  vs. every incumbent. Reuses the sense-check extractor for the AI half.
- **`document-viewer`** (12) — read-only in-app viewer. Resolves the contradiction
  where redaction (needs a preview to draw on) and Q&A auditability depend on a
  viewer the brief had deferred to Phase 2.
- **`notifications`** (13) — the product-email/in-app notification system both
  `onboarding-flow` and `admin-dashboard` referenced but never scoped.
- **`search-ocr`** (14) — OCR (no more silent blind spots on scanned docs) +
  keyword full-text search beside semantic Q&A.
- **`data-export`** (15) — the customer-facing export + GDPR portability +
  offboarding/purge lifecycle that NFR7 enabled but no feature owned.
- **`virus-scanning`** (16) — scan-on-upload + quarantine; clean-gates every
  consumer.

Rationale in `docs/product/positioning.md`; sequencing in
`docs/product/implementation-plan.md`. **Minor gap — a per-org feature-flag
mechanism (`ai-search-qna` assumes `qna_enabled`) — is tracked in
`docs/product/production-readiness.md`, folded into `auth-and-orgs` rather than
given its own slice.**

## Phase-2 backlog (out of MVP)

- request-intercept-hitl
- learned-approve-reject
- scheduled-maintenance
- ma-workflow / rfp-response
- internal-kb-mode
- storage-sync (onedrive/gdrive)
- watermark-preview-drm — *decision pending:* hold at Phase 2 if we stay in the
  SME vendor/RFP lane; pull forward only if chasing regulated M&A (see
  `docs/product/positioning.md`).
- soc2-iso27001 (compliance track)

## Change log

- 2026-04-21 — Initial index created, pending brief sign-off.
- 2026-04-21 — `auth-and-orgs` slice: `requirements.md`, `design.md`,
  and `tasks.md` drafted. Pending Bradley sign-off on design → unblocks
  scaffold (T-001).
- 2026-04-21 — `requirements.md` drafted for slices 2–5:
  `room-and-folders`, `access-control`, `doc-checklist`,
  `ai-doc-sensecheck`. Pending Bradley sign-off.
- 2026-04-21 — `requirements.md` drafted for slices 6–9:
  `ai-search-qna`, `admin-dashboard`, `billing-subscription`,
  `onboarding-flow`. All nine slices now have a requirements.md.
  Design + tasks for slices 2–9 pending.
- 2026-04-21 — `design.md` + `tasks.md` drafted for slices 2–3:
  `room-and-folders` (S3 + Postgres metadata, virtual canonical
  folders) and `access-control` (middleware + download revalidator,
  NDA flow). ADRs 003–005 flagged.
- 2026-04-21 — `design.md` + `tasks.md` drafted for slices 4–5:
  `doc-checklist` (templates-in-code snapshotted per-org, slot
  instances + state machine) and `ai-doc-sensecheck` (async SQS
  worker, Claude Haiku 4.5 default, fail-yellow never-blocks,
  golden-set eval harness). ADRs 006–008 flagged.
- 2026-04-22 — `design.md` + `tasks.md` drafted for slices 6–9:
  `ai-search-qna` (pgvector in-VPC, double access-control filter,
  Sonnet 4.6 generator + Haiku 4.5 re-ranker, eval harness),
  `admin-dashboard` (pure-UI slice, 9 routes, 3 BFF aggregates,
  bundle/a11y/perf budgets in CI), `billing-subscription`
  (Stripe-as-SoT mirror, plan limits in code, CLI back-door,
  read-only on past_due), `onboarding-flow` (6-step resumable
  wizard, persisted progress, static sample room, PostHog
  activation metrics). ADRs 009–010 flagged. **All 9 slices now
  spec-complete; ready for Bradley sign-off + scaffold (T-001 of
  auth-and-orgs).**
- 2026-04-22 — ADR-001 (WorkOS as auth platform) and ADR-002
  (Postgres + Drizzle for the ai-data-room domain) drafted and
  marked `accepted`. ADR index updated.
- 2026-04-22 — Repo scaffolded at
  `~/Documents/projects/personal/ai-data-room` from
  `sst-monorepo-template`. Package names migrated to
  `@ai-data-room/*`, new `packages/db` workspace added (Drizzle +
  pgvector-ready), `infra/{api,web,storage,secrets,db}.ts` modules
  authored, `microservices/core/src/{domain,application,handlers,
infrastructure,middleware}` skeleton created with one folder per
  slice, `.kiro/specs/ai-data-room/` snapshot synced, `CLAUDE.md`
  - `AGENTS.md` + `README.md` written. Auth-and-orgs T-001 is
    effectively done — task ticking can begin once Bradley confirms
    the repo location + GitHub destination.
- 2026-04-22 — Repo pushed to
  `github.com/Evans-Software-Solutions-Limited/ai-data-room`
  (commit `9ba0733`). Auth-and-orgs **T-001 closed**.
- 2026-04-22 — Auth-and-orgs **T-002 in flight**: secrets registry
  rewritten to FDP convention (snake_case + SCREAMING_SNAKE), WorkOS +
  PlanetScale secrets linked into the coreAPI `$default` route, and
  `/_health/workos` smoke-test handler + unit tests landed under
  `microservices/core/src/handlers/auth/`. Pending Bradley actions:
  create the WorkOS project, `bun sst secret set ...` for each stage,
  deploy + run `scripts/check-workos-health.ts`.
- 2026-05-31 — Spec-alignment pass after a production-readiness audit +
  2026 competitive scan (`chore/spec-alignment`). Added
  `docs/product/positioning.md` (competitive north star),
  `docs/product/production-readiness.md` (release-blocker register +
  showcase sequencing), `docs/product/implementation-plan.md` (ordered
  backlog), and [ADR-011](../../../adr/011-multi-tenant-isolation.md)
  (row-level tenant isolation, `proposed`). `watermark-preview-drm` timing
  now carries an explicit pending decision.
- 2026-05-31 — Two new feature slices spec-completed to the full three-file
  standard: **`tenant-isolation`** (slice 10, gates slice 2 per ADR-011) and
  **`document-redaction`** (slice 11, manual + AI-assist).
- 2026-05-31 — Seam review surfaced five more unscoped features; all
  spec-completed to the three-file standard: **`document-viewer`** (12),
  **`notifications`** (13), **`search-ocr`** (14), **`data-export`** (15),
  **`virus-scanning`** (16). Feature-flag mechanism folded into `auth-and-orgs`
  via a production-readiness note (no own slice).
- 2026-05-31 — Post-slice-1-merge alignment (after PR #28 merged to `main` at
  `2be475c`, tag `v0.1.0-auth-and-orgs`). The slice-1 closing brief revealed org
  **provisioning** was deferred to slice 9, leaving slices 2/10 without an
  `org_id`. Added **`org-provisioning`** (slice 17), pulled forward out of slice
  9, sequenced 1 → 17 → 10 → 2. Aligned the new specs to shipped slice-1
  patterns (audit via `safeAudit`/`recordAuditEvent` + `AuditEventTypeSchema`
  extension; `EXPECTED_TABLES` one-liner per new table, sticky #25). **Pending
  Bradley sign-off on ADR-011, slices 10–17 (requirements + design), and the
  watermark/fence-view timing call.**
