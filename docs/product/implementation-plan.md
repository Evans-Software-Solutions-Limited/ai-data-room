# Implementation plan — ai-data-room

**Status:** draft for sign-off (2026-05-31). Owner: Bradley. Sits alongside
[positioning](./positioning.md), [production-readiness](./production-readiness.md),
and the [spec index](../../.kiro/specs/ai-data-room/README.md).

> Purpose: the single ordered backlog to hand to Claude Code. Once Bradley
> signs this off, implementation proceeds one task → one branch → one PR, in
> the order below. Each slice's `tasks.md` is the detailed contract; this doc
> is the **sequence and the deltas**, not a replacement for them.

## How to use this with Claude Code

1. Start at the lowest-numbered open item in the current phase.
2. Branch per task: `feat/<slice>-T-XXX-<short-desc>` (or `chore/<desc>`).
3. Honour the slice's `tasks.md` DoD + the 90% coverage gate.
4. Tick `[x]` in `tasks.md` after merge; refresh `HANDOFF.md` at each transition.

## Phase 0 — clear the decks (no new product code)

These gate clean implementation and let us sign off "docs + foundation current."

| Item | Action | Owner | Blocking? |
| --- | --- | --- | --- |
| Sign off [ADR-011](../../adr/011-multi-tenant-isolation.md) | Accept (or amend) row-level tenant isolation as a slice-2 prerequisite. | Bradley | Yes — gates slice 2 |
| Redaction scope call | Decide: document redaction in MVP (proposed) vs Phase 2. | Bradley | Yes — gates the slice-2 task list |
| Watermark/fence-view call | Confirm Phase 2 (SME lane) or pull forward (M&A). | Bradley | No |
| Merge T-022 (PR #28) | Finish slice-1 sign-off + tag `v0.1.0-auth-and-orgs`. | Bradley | No (parallel) |
| RB-2 — e2e stage | Provision e2e env + WorkOS test tenant so slice-1 Playwright actually runs. | Bradley | No (before GA) |
| RB-4 — delete `hello-world` cruft | Remove template scaffolding from `core` + `workers`. | chore PR | No |

## Phase 1 — the showcase loop

Goal: a demoable **upload → AI sense-checks it → ask a cited question → get an
auditable answer** loop. Sequenced for demo value within the spec's dependency
rules (4/5/6 each need 2).

1. **Slice 2 — `room-and-folders`** (T-001 → T-020). The foundation: S3 + KMS,
   four tables, repos, upload/list/download, opportunity subrooms, web folder
   nav + dropzone. **Carries the new tenant-isolation task (below) and, if
   approved, the redaction task.**
2. **Slice 6 — `ai-search-qna`** (T-001 → T-022). The hero. pgvector + HNSW,
   indexer worker, query flow with the double access-filter, Sonnet 4.6
   generator + Haiku re-ranker, eval harness, chat pane with citation chips.
   **This is the demo moment — prioritise its web surface (T-016) and eval
   harness (T-015).**
3. **Slice 5 — `ai-doc-sensecheck`** (T-001 → ...). Proactive AI: on-upload
   classification vs. the slot's expected criteria, fail-yellow-never-blocks,
   golden-set eval. The mismatch badge + callout from the design brief.
4. **Slice 4 — `doc-checklist`** (T-001 → ...). Fixed per-folder templates,
   slot state machine — completes the self-serve onboarding story.

After Phase 1 you can run the full headline demo end to end.

## Phase 2 — toward GA

5. **Slice 3 — `access-control`** — date-expiring invites, NDA gate, view vs
   download tiers. (Strictly a dependency of external sharing; pull earlier if
   the demo needs real external-viewer scoping rather than mocked.)
6. **Slice 8 — `billing-subscription`** — Stripe; parallelisable once slice 1
   is tagged.
7. **Slice 7 — `admin-dashboard`** — BFF aggregate over 1–6.
8. **Slice 9 — `onboarding-flow`** — ties 1 + 4 + 8 together; ships last.

## Proposed new tasks (pending sign-off, then inserted into the owning `tasks.md`)

**Slice 2 — `room-and-folders`, new task `T-004a` — Tenant isolation guard.**
- *Scope:* a `scopedRepo(orgId)` factory (or equivalent) that every
  tenant-scoped repository must route through; a lint/CI guard against raw
  repo access; a property test generating adversarial `org_id`s proving no
  query returns another org's rows. Backfill the guard onto slice-1 org-scoped
  repos.
- *Depends on:* T-004 (repositories). *Blocks:* every later slice-2 task that
  reads/writes documents (T-006–T-009, T-011).
- *DoD:* property test green; lint guard active; ADR-011 moved to `accepted`.

**Slice 2 (manual) + Slice 5 (AI-assist) — Document redaction** *(only if the
scope call says MVP).*
- *Scope:* manual redaction box-drawing on preview + persisted redacted
  rendition at download (slice 2); AI-suggested redaction regions reusing the
  sense-check extraction pipeline, surfaced in `signal` amber (slice 5).
- *Note:* this is bigger than one task — needs a short requirements addition to
  `room-and-folders/requirements.md` (and `ai-doc-sensecheck` for the AI half)
  before tasks are written. Treat as a Phase-1.5 mini-spec.

## Sign-off checklist (what "docs up to date" means)

- [ ] ADR-011 reviewed — `proposed` → `accepted` or amended.
- [ ] Redaction: MVP or Phase 2 — decided and reflected in slice 2/5 specs.
- [ ] Watermark/fence-view timing — confirmed.
- [ ] This plan's Phase 1 order — accepted.
- [ ] Slice 2 selected as the next implementation target; first branch
      `feat/room-and-folders-T-001-storage-infra`.
