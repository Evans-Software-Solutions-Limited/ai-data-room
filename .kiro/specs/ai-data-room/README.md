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

| # | Slice | Depends on | Status | Why it's first/later |
|---|---|---|---|---|
| 1 | `auth-and-orgs` | — | reqs + design + tasks drafted | Foundation. Every other slice touches org tenancy + user identity. |
| 2 | `room-and-folders` | 1 | reqs + design + tasks drafted | The canonical six-folder room + Opportunities subrooms. Upload/list/delete primitives. |
| 3 | `access-control` | 1, 2 | reqs + design + tasks drafted | Date-expiring invites, revocable, tiered permissions, NDA gate, audit log. |
| 4 | `doc-checklist` | 2 | reqs + design + tasks drafted | Fixed per-folder checklist templates; drives self-service completion UX. |
| 5 | `ai-doc-sensecheck` | 2, 4 | reqs + design + tasks drafted | On-upload Claude classification vs. the slot's expected criteria. |
| 6 | `ai-search-qna` | 2 | reqs + design + tasks drafted | Cited Q&A chat grounded in uploaded docs. |
| 7 | `admin-dashboard` | 1–6 | reqs + design + tasks drafted | Aggregates every earlier slice into the admin UX. |
| 8 | `billing-subscription` | 1 | reqs + design + tasks drafted | Stripe. Can run in parallel with 2–6 once 1 is done. |
| 9 | `onboarding-flow` | 1–4 | reqs + design + tasks drafted | Self-serve signup + first-room setup wizard. |

**Parallelisation notes:**
- Once slice 1 is shipped, slices 2 and 8 can run in parallel.
- Slices 4/5/6 can run in parallel once slice 2 is shipped.
- Slices 7 and 9 are the "tie it together" slices — they should land last.

## Repo layout convention (once scaffolded)
Scaffolded from `~/Documents/projects/personal/sst-monorepo-template`.
Target repo: TBD (Bradley to confirm path + GitHub org — likely
`Evans-Software-Solutions-Limited/ai-data-room`). Each slice corresponds
to a feature folder / workspace inside the monorepo, not a separate repo.

## Phase-2 backlog (out of MVP)
- request-intercept-hitl
- learned-approve-reject
- scheduled-maintenance
- ma-workflow / rfp-response
- internal-kb-mode
- storage-sync (onedrive/gdrive)
- watermark-preview-drm
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
  + `AGENTS.md` + `README.md` written. Auth-and-orgs T-001 is
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
