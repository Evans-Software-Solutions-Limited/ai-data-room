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
4. Tick `[x]` in `tasks.md` after merge; deliver the session handoff in chat (no committed handoff file).

## Phase 0 — clear the decks (no new product code)

These gate clean implementation and let us sign off "docs + foundation current."

| Item                                                        | Action                                                                      | Owner    | Blocking?                         |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | -------- | --------------------------------- |
| Sign off [ADR-011](../../adr/011-multi-tenant-isolation.md) | Accept (or amend) row-level tenant isolation as a slice-2 prerequisite.     | Bradley  | Yes — gates slice 2               |
| Redaction scope call                                        | Decide: document redaction in MVP (proposed) vs Phase 2.                    | Bradley  | Yes — gates the slice-2 task list |
| Watermark/fence-view call                                   | Confirm Phase 2 (SME lane) or pull forward (M&A).                           | Bradley  | No                                |
| Merge T-022 (PR #28)                                        | Finish slice-1 sign-off + tag `v0.1.0-auth-and-orgs`.                       | Bradley  | No (parallel)                     |
| RB-2 — e2e stage                                            | Provision e2e env + WorkOS test tenant so slice-1 Playwright actually runs. | Bradley  | No (before GA)                    |
| RB-4 — delete `hello-world` cruft                           | Remove template scaffolding from `core` + `workers`.                        | chore PR | No                                |

## Phase 1 — the showcase loop

Goal: a demoable **upload → AI sense-checks it → ask a cited question → get an
auditable answer** loop. Sequenced for demo value within the spec's dependency
rules (4/5/6 each need 2).

0a. **Slice 17 — `org-provisioning`** (T-001 → T-006). Runs first: nothing
self-serve creates an `org_id` until this lands (slice 1 left `/me.orgId =
   null`). Owner-creates-org → first membership → `org.created` → flips `/me`.
Slices 10 + 2 attach to the org it creates.
0b. **Slice 10 — `tenant-isolation`** (T-001 → T-008). Cross-cutting hardening;
gates document storage. ADR-011 moves to `accepted` on its T-006 (property
test) green.

1. **Slice 2 — `room-and-folders`** (T-001 → T-020). The foundation: S3 + KMS,
   four tables, repos, upload/list/download, opportunity subrooms, web folder
   nav + dropzone. Its document-bearing tasks (T-006+) depend on slice 10.
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

## The two new feature slices (now full three-file specs)

Both were promoted from "proposed tasks" into proper kiro slices with
`requirements.md` + `design.md` + `tasks.md`, pending sign-off:

- **`tenant-isolation`** (slice 10) —
  [requirements](../../.kiro/specs/ai-data-room/tenant-isolation/requirements.md) ·
  [design](../../.kiro/specs/ai-data-room/tenant-isolation/design.md) ·
  [tasks](../../.kiro/specs/ai-data-room/tenant-isolation/tasks.md).
  Executes first in Phase 1; ADR-011 is accepted on its property-test task.
- **`document-redaction`** (slice 11) —
  [requirements](../../.kiro/specs/ai-data-room/document-redaction/requirements.md) ·
  [design](../../.kiro/specs/ai-data-room/document-redaction/design.md) ·
  [tasks](../../.kiro/specs/ai-data-room/document-redaction/tasks.md).
  Follows slice 2; needs slice 12's viewer; AI-assist half soft-depends on slice
  5's extractor. Ship the manual half for MVP; AI-assist is the differentiator.

Five more slices (12–16) came out of the seam review, all spec-complete:

- **`document-viewer`** (12) — lands with/just-before redaction (provides the
  preview surface) and enhances Q&A citation deep-linking.
- **`virus-scanning`** (16) — land **early in slice 2's life**; its clean-gate
  touches the upload pipeline and the AI slices index off
  `document.scanned.clean` instead of raw upload.
- **`search-ocr`** (14) — alongside/after slice 6 (shares the indexing bus);
  OCR also feeds sense-check + redaction.
- **`notifications`** (13) — leaf dependency; schedule once slices 2–6 emit
  their events (good companion to the admin-dashboard work).
- **`data-export`** (15) — after slice 2; its offboarding half pairs with
  slice 8 (billing) cancellation events.

Specs: see the [slice index](../../.kiro/specs/ai-data-room/README.md) rows
12–16. Sequencing for these is flexible within their dependencies — fold them
into the phases above as capacity allows; none block the Phase 1 demo loop
except slices 12 + 16, which pair with slice 2/11.

**`org-provisioning`** (slice 17) is **not** flexible — it runs first (step 0a),
because slices 2 and 10 both attach to an `org_id` that nothing provisioned
self-serve before it. Pulled forward out of slice 9, which now wraps it in UX.
Spec:
[requirements](../../.kiro/specs/ai-data-room/org-provisioning/requirements.md) ·
[design](../../.kiro/specs/ai-data-room/org-provisioning/design.md) ·
[tasks](../../.kiro/specs/ai-data-room/org-provisioning/tasks.md).

## Sign-off checklist (what "docs up to date" means)

- [ ] ADR-011 reviewed — `proposed` → `accepted` or amended.
- [ ] `org-provisioning` (slice 17) requirements + design signed off.
- [ ] `tenant-isolation` (slice 10) requirements + design signed off.
- [ ] `document-redaction` (slice 11) requirements + design signed off;
      manual half confirmed for MVP.
- [ ] Watermark/fence-view timing — confirmed.
- [ ] This plan's Phase 1 order — accepted.
- [ ] First implementation target = `org-provisioning` T-001; first branch
      `feat/org-provisioning-T-001-create-org-dto`.
