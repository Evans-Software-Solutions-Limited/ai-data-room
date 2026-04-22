# Tasks — ai-data-room / ai-doc-sensecheck

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-04-21

Assumes `auth-and-orgs` (v0.1), `room-and-folders` (v0.2), and
`doc-checklist` (v0.4) are merged. Runs in the same monorepo.
`access-control` (v0.3) recommended but not strictly required — the
`requires(...)` decorator will no-op until it lands.

## Conventions
Same as prior slices.

---

## T-001 — Migrations: decisions + prompt registry + counters
Status: `[ ]`
**Scope:** Drizzle migrations for `ai_decisions`, `prompt_versions`,
`sensecheck_usage_counters`, `sensecheck_rate_budgets`. Indexes per
design.md.
**Files (likely):** `packages/db/schema/sensecheck.ts`,
`packages/db/migrations/*.sql`.
**DoD:** Applies + rolls back in test; drizzle introspection clean.
**Tests required:** Integration migration.

---

## T-002 — Domain: types + zod schemas
Status: `[ ]`
**Scope:** `Verdict` enum, `DecisionRecord`, `DecisionInput`,
`DecisionSchema` (Zod, strict), `PromptVersion`, `SensecheckInput`
(slotTitle, criteria, summary, mime, docBytes-or-extractedText),
`FailureReason` enum.
**Files (likely):** `microservices/core/domain/sensecheck/*.ts`,
`packages/api-utils/schemas/sensecheck.ts`.
**DoD:** Barrel exports; schema tests.
**Tests required:** Vitest — happy + failure cases per schema.

---

## T-003 — Domain: prompt v1 module
Status: `[ ]`
**Scope:** `microservices/core/domain/sensecheck/prompts/sensecheck-v1.ts`
— system prompt, user template, response schema, model default
(`claude-haiku-4-5-20251001`). `index.ts` exports current + map
by id. Deploy-time seed writes row into `prompt_versions` with
`sha256` computed from the module's exported string.
**Files (likely):**
`microservices/core/domain/sensecheck/prompts/*.ts`,
`microservices/core/infrastructure/db/sensecheck/prompt-seed.ts`.
**DoD:** Deploy job idempotent; re-deploy same prompt → no DB
change; edited prompt → new row + `is_current` flipped.
**Tests required:** Unit (hash stability) + integration (seed idempotent).

---

## T-004 — Infrastructure: repositories
Status: `[ ]`
**Scope:** `AiDecisionRepo` (insert, listQueue, getById,
markSuperseded), `PromptVersionRepo` (getCurrent, upsertBySha),
`UsageCounterRepo` (incrementAtomic, get),
`RateBudgetRepo` (redisCheckAndIncrement with fallback).
**Files (likely):**
`microservices/core/infrastructure/db/sensecheck/*.ts`,
`microservices/core/infrastructure/redis/rate-budget.ts`.
**DoD:** Integration tests for each method.
**Tests required:** Vitest integration.

---

## T-005 — Infrastructure: text extractor module
Status: `[ ]`
**Scope:** `extract(mime, bytes)` → `{ text, truncated, estimatedTokens }`.
Uses `pdf-parse`, `mammoth`, `xlsx`, `pptx` parsers. Budget-truncates
to 5,000 tokens (tokenizer approximation using
`@anthropic-ai/tokenizer`). Returns `unsupported` for other mimes.
**Files (likely):**
`microservices/core/infrastructure/sensecheck/extract.ts`.
**DoD:** Each supported mime passes a fixture round-trip test; oversize
doc correctly truncates.
**Tests required:** Vitest with fixture files under
`tests/fixtures/sensecheck/samples/`.

---

## T-006 — Infrastructure: Anthropic client wrapper
Status: `[ ]`
**Scope:** Thin wrapper over `@anthropic-ai/sdk` exposing
`senseCheck(input, promptVersion) → { decision, usage, latencyMs }`.
Enforces strict JSON output via the SDK's tool-use; validates via Zod
schema from T-002; returns a tagged-union with failure reasons.
Retries upstream 5xx with exponential backoff, max 3 attempts.
**Files (likely):**
`microservices/core/infrastructure/anthropic/sensecheck-client.ts`.
**DoD:** Unit-tested with mocked SDK; integration test hits real API
in e2e stage (skipped unless ANTHROPIC_API_KEY set).
**Tests required:** Vitest + conditional integration.

---

## T-007 — Application: sense-check job
Status: `[ ]`
**Scope:** `runSenseCheck({orgId, documentVersionId, slotInstanceId, trigger: 'upload'|'recheck'})` —
orchestrates: rate-budget → quota → S3 fetch → extract → Anthropic
call → persist decision → emit state transition via doc-checklist's
`approveSlot` when auto-approve applies → emit `slot.ai_checked`.
Pure of transport.
**Files (likely):**
`microservices/core/application/sensecheck/run.ts`.
**DoD:** Integration coverage for every branch (FR3 mapping, FR9
oversize, FR10 upstream fail, FR11 rate limit, NFR5 quota).
**Tests required:** Vitest integration with mocked Anthropic.

---

## T-008 — Application: org settings toggle
Status: `[ ]`
**Scope:** `getSensecheckSettings(orgId)`, `setAutoApproveGreen`.
Persist on `organizations` (add column `sensecheck_auto_approve_green
bool default true`). Audit event on change.
**Files (likely):** migration add-column (extend T-001 or separate
migration), `microservices/core/application/sensecheck/settings.ts`.
**DoD:** FR4 covered.
**Tests required:** Integration.

---

## T-009 — Handler: SQS worker + EventBridge rule
Status: `[ ]`
**Scope:** SST Lambda subscribed to `sensecheck-jobs` SQS queue with
DLQ. EventBridge rule routes `slot.uploaded` events into the queue.
Handler calls `runSenseCheck`. Concurrency capped per-org via
`maxConcurrency` in SST.
**Files (likely):**
`microservices/core/handlers/sensecheck/worker.ts`,
`infra/sensecheck.ts`.
**DoD:** Deploying the stack creates the queue, DLQ, rule, lambda
with correct IAM.
**Tests required:** Integration — publish event, assert decision
persisted within 60s.

---

## T-010 — HTTP handlers: queue, decision detail, recheck, settings
Status: `[ ]`
**Scope:** Wire application layer into HTTP per design.md §Interfaces.
All routes behind `requires(target, capability)` decorator.
**Files (likely):**
`microservices/core/handlers/sensecheck/*.ts`.
**DoD:** Every route responds per schema.
**Tests required:** Integration per route.

---

## T-011 — Eval harness CLI
Status: `[ ]`
**Scope:** `bun run eval:sensecheck` — loads golden set from
`tests/fixtures/sensecheck/eval/*.json`, runs current prompt,
computes confusion matrix, compares to snapshot, exits non-zero on
>3pp regression.
**Files (likely):**
`scripts/eval-sensecheck.ts`,
`tests/fixtures/sensecheck/eval/snapshot.json`,
`.github/workflows/sensecheck-eval.yml`.
**DoD:** CI runs the eval on PRs touching prompts or templates;
snapshot update requires explicit commit.
**Tests required:** Script dry-run test.

---

## T-012 — Golden set seeding
Status: `[ ]`
**Scope:** Collect ≥30 fixtures across the canonical slots (a mix of
clearly-correct, clearly-wrong, and borderline docs). Track each with
expected verdict + rationale hint. Anonymised / synthetic content
only — no real customer docs.
**Files (likely):** `tests/fixtures/sensecheck/eval/*.json`,
`tests/fixtures/sensecheck/samples/*.{pdf,docx,xlsx,pptx,png}`.
**DoD:** Fixture count meets bar; initial snapshot ≥85% accuracy.
**Tests required:** Implicit via T-011.

---

## T-013 — Web: slot verdict display
Status: `[ ]`
**Scope:** Extend slot detail panel (`doc-checklist` T-017) to render
traffic light, rationale, confidence, matched/missing criteria from
the most recent decision. "AI is thinking…" state while
`slot.state='ai_checking'`.
**Files (likely):**
`packages/web/app/room/**/_components/SlotDetail.tsx` (extend),
`packages/web/app/room/**/_components/AiVerdictPanel.tsx` (new).
**DoD:** AC-US1, AC-US2, AC-US6 pass.
**Tests required:** Playwright.

---

## T-014 — Web: admin review queue
Status: `[ ]`
**Scope:** `/admin/review` page listing pending decisions; sortable
by confidence / age / folder. Approve/reject inline; clicking an
item opens slot detail.
**Files (likely):** `packages/web/app/admin/review/**/*.tsx`.
**DoD:** AC-US3, AC-US4 pass.
**Tests required:** Playwright.

---

## T-015 — Web: sense-check settings page
Status: `[ ]`
**Scope:** Settings → Sense-check: toggle `auto_approve_green`, show
current model + prompt version (read-only), show monthly usage
gauge.
**Files (likely):** `packages/web/app/settings/sensecheck/**/*.tsx`.
**DoD:** AC-US5 passes.
**Tests required:** Playwright.

---

## T-016 — Observability: metrics + alerts
Status: `[ ]`
**Scope:** Emit metrics per design.md §Observability. Wire alarms:
`bad_model_output > 1%`, `anthropic_unavailable > 5%`,
`quota.reaches_ceiling`.
**Files (likely):**
`microservices/core/infrastructure/metrics/sensecheck.ts`,
`infra/observability.ts`.
**DoD:** Metrics observable; synthetic events fire alarms in test.
**Tests required:** Smoke.

---

## T-017 — Feature flag integration
Status: `[ ]`
**Scope:** `sensecheck_enabled` per-org. Off → events not consumed;
slots stay at `uploaded` for admin action.
**Files (likely):**
`microservices/core/application/feature-flags.ts` (extend).
**DoD:** Toggling off leaves the system clean — no orphan in-flight
jobs, no stale states.
**Tests required:** Integration + Playwright.

---

## T-018 — NFR hardening pass
Status: `[ ]`
**Scope:** Verify NFR1 (no non-AWS/Anthropic egress — net-test),
NFR2 (no full doc text in logs — scrub check), NFR3 (model + prompt
version on every decision — DB invariant test), NFR4 (config-only
model switch — inspect code), NFR5 (quota hard ceiling — integration
test), NFR6 (eval snapshot enforcement in CI).
**Files (likely):**
`tests/security/sensecheck-nfr-matrix.spec.ts`.
**DoD:** Matrix green in CI.

---

## T-019 — Playwright acceptance suite
Status: `[ ]`
**Scope:** One spec per AC-US1–AC-US6.
**Files (likely):** `tests/e2e/sensecheck/*.spec.ts`.
**DoD:** All 6 specs green on e2e.

---

## T-020 — Slice sign-off + ADR-007 + ADR-008
Status: `[ ]`
**Scope:** Draft ADR-007 (sensecheck async worker) + ADR-008
(Haiku 4.5 default) linked from design.md. Traceability matrix.
Tag `v0.5.0-ai-doc-sensecheck`.
**Files (likely):** `adr/007-sensecheck-async.md`,
`adr/008-sensecheck-model-default.md`,
`docs/slices/ai-doc-sensecheck.md`.
**DoD:** ADRs + matrix merged; tag pushed.

---

## Dependencies

```
T-001 ─► T-003 ─► T-004 ─► T-007 ─► T-009 ─► T-010 ─► T-013/14/15
         ▲         ▲        ▲                 ▲
T-002 ──►│         │        │                 │
T-005 ──────────►  │        │                 │
T-006 ──────────►  │        │                 │
                            │                 │
                  T-008 ────┤                 │
                                              │
T-011 ─► T-012 (can start once T-003 present)

T-016, T-017, T-018 in parallel after T-010
T-019 after T-013–T-015
T-020 last
```

Parallelisable after T-002:
- T-005 / T-006 / T-008 — independent infrastructure.
- Web tasks (T-013–T-015) after T-010.

## Acceptance for the slice
1. All AC-US* in `requirements.md` pass in Playwright.
2. Eval harness baseline ≥85% accuracy, committed snapshot.
3. T-020 traceability + ADRs merged.
4. `v0.5.0-ai-doc-sensecheck` tagged.
