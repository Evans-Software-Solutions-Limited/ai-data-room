# Tasks — ai-data-room / ai-search-qna

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-04-21

Assumes `auth-and-orgs` (v0.1), `room-and-folders` (v0.2),
`access-control` (v0.3), `doc-checklist` (v0.4), `ai-doc-sensecheck`
(v0.5) are all merged. Runs in the same monorepo.

## Conventions
Same as prior slices.

---

## T-001 — Postgres: enable pgvector + provision HNSW
Status: `[ ]`
**Scope:** Enable `vector` extension on the Postgres cluster; verify
version ≥ 0.7 for HNSW. Capacity planning note in
`docs/infra/pgvector.md`.
**Files (likely):** `packages/db/migrations/*enable-vector*.sql`,
`docs/infra/pgvector.md`.
**DoD:** `CREATE EXTENSION` succeeds in all stages; HNSW
availability verified.
**Tests required:** Integration — migration apply test.

---

## T-002 — Migrations: passages + conversations + turns + exclusions + counters
Status: `[ ]`
**Scope:** Drizzle migrations for all five tables per design.md,
including HNSW index on `qna_passages.embedding`.
**Files (likely):** `packages/db/schema/qna.ts`,
`packages/db/migrations/*.sql`.
**DoD:** Applies + rolls back; HNSW creates successfully.
**Tests required:** Integration migration test.

---

## T-003 — Domain: types + zod schemas
Status: `[ ]`
**Scope:** `Passage`, `Anchor`, `Conversation`, `Turn`, `Citation`,
`AnswerSchema` (strict — enforces `[cN]` markers match
`citations`), `Scope` discriminated union, `QnaUsageSnapshot`.
**Files (likely):** `microservices/core/domain/qna/*.ts`,
`packages/api-utils/schemas/qna.ts`.
**DoD:** Barrel exports; schema tests.
**Tests required:** Vitest — including negative tests for the
citation-marker invariant.

---

## T-004 — Infrastructure: embedding client wrapper
Status: `[ ]`
**Scope:** `embed(text, model)` — default Voyage-3 via Anthropic
umbrella; fallback config for Bedrock Titan v2. Batching,
exponential backoff, timeouts. Returns `number[]` of fixed length
1024.
**Files (likely):**
`microservices/core/infrastructure/embedding/client.ts`.
**DoD:** Unit tested with mocks; integration test skipped unless
API keys set.
**Tests required:** Vitest.

---

## T-005 — Infrastructure: passage chunker
Status: `[ ]`
**Scope:** `chunkDocument(extractedPages, opts)` →
`Array<{anchor, text, tokenCount}>`. Respects ~1000-token target
with ~200-token overlap and paragraph-boundary preference.
**Files (likely):** `microservices/core/infrastructure/qna/chunk.ts`.
**DoD:** Unit-tested against fixture documents covering pdf, docx,
pptx, xlsx; edge cases (single-page, huge-page, empty-page).
**Tests required:** Vitest.

---

## T-006 — Infrastructure: passage repository
Status: `[ ]`
**Scope:** `PassageRepo` — `upsertBatch`, `deleteByDocument`,
`deleteByOrg` (for org offboarding), `searchByEmbedding(query,
orgFilter, scopeFilter, exclusions, limit)`. SQL uses HNSW `<=>`
operator with `ef_search` set via GUC.
**Files (likely):**
`microservices/core/infrastructure/db/qna/passage-repo.ts`.
**DoD:** Each method integration-tested; search returns top-K sorted.
**Tests required:** Vitest integration.

---

## T-007 — Infrastructure: conversation + turn repos
Status: `[ ]`
**Scope:** `ConversationRepo` (`create`, `listForUser`, `get`,
`delete`), `TurnRepo` (`appendUser`, `appendAssistant`,
`lastNTurns`).
**Files (likely):**
`microservices/core/infrastructure/db/qna/conversation-repo.ts`,
`microservices/core/infrastructure/db/qna/turn-repo.ts`.
**DoD:** Integration tests.
**Tests required:** Vitest.

---

## T-008 — Infrastructure: exclusions repo + counters repo
Status: `[ ]`
**Scope:** `ExclusionRepo`, `UsageCounterRepo` (atomic increment,
monthly read).
**Files (likely):**
`microservices/core/infrastructure/db/qna/exclusion-repo.ts`,
`microservices/core/infrastructure/db/qna/usage-repo.ts`.
**DoD:** Integration tested.
**Tests required:** Vitest.

---

## T-009 — Application: indexer job
Status: `[ ]`
**Scope:** `indexDocument({orgId, documentVersionId})` — downloads
from S3, extracts via shared sensecheck extractor, chunks
(T-005), embeds (T-004), upserts (T-006). Deletes prior passages
for the same document in the same transaction.
**Files (likely):**
`microservices/core/application/qna/indexer.ts`.
**DoD:** Integration covers PDF, DOCX, XLSX, PPTX; idempotent on
re-run.
**Tests required:** Vitest integration.

---

## T-010 — Application: delete passages on doc lifecycle
Status: `[ ]`
**Scope:** `removeDocument({orgId, documentId})` — called on
soft-delete, slot reset, slot reject, exclusion add.
**Files (likely):**
`microservices/core/application/qna/remove.ts`.
**DoD:** Passage count drops to zero within 5 min SLA.
**Tests required:** Integration with freshly-indexed fixture.

---

## T-011 — Application: query flow
Status: `[ ]`
**Scope:** `ask({session, scope, conversationId, question})` —
orchestrates full flow per design.md. Handles "no candidates"
short-circuit (FR10). Double access filter implemented per §Query
flow step 5.
**Files (likely):**
`microservices/core/application/qna/ask.ts`.
**DoD:** Unit tests cover every branch; integration test covers
happy path with 500-passage fixture.
**Tests required:** Vitest + integration.

---

## T-012 — Application: re-rank + generator prompt invocation
Status: `[ ]`
**Scope:** `rerank(candidates, question)` → top-10 via Haiku prompt;
`generateAnswer(passages, question, history)` → Sonnet call with
strict JSON schema; response validated with Zod; `[cN]` invariant
enforced.
**Files (likely):**
`microservices/core/domain/qna/prompts/retriever-rerank-v1.ts`,
`microservices/core/domain/qna/prompts/answer-generator-v1.ts`,
`microservices/core/infrastructure/anthropic/qna-client.ts`.
**DoD:** Malformed output rejected; eval harness passes baseline.
**Tests required:** Vitest.

---

## T-013 — Handlers: EventBridge → SQS → indexer worker
Status: `[ ]`
**Scope:** SQS queue `qna-index-jobs` + DLQ + EventBridge rules on
`slot.approved`, `document.softDeleted`, `slot.rejected`,
`slot.reset`, `qna.exclusion.added`, `qna.exclusion.removed`.
Worker lambda.
**Files (likely):**
`microservices/core/handlers/qna/indexer-worker.ts`,
`infra/qna.ts`.
**DoD:** Deploy creates infra + IAM; integration asserts
indexing happens after an `slot.approved` event.
**Tests required:** Integration.

---

## T-014 — Handlers: HTTP routes
Status: `[ ]`
**Scope:** All routes per design.md §Interfaces. All behind
`requires(...)`. External users can only ask in Opportunity scope
(403 otherwise).
**Files (likely):** `microservices/core/handlers/qna/*.ts`.
**DoD:** Every route responds per schema; external-user
cross-scope attempts → 403.
**Tests required:** Integration.

---

## T-015 — Eval harness CLI + golden set
Status: `[ ]`
**Scope:** `bun run eval:qna` — loads fixtures, runs full pipeline,
measures precision/recall/i-don't-know-correctness. Snapshot-gated
in CI.
**Files (likely):** `scripts/eval-qna.ts`,
`tests/fixtures/qna/eval/*.json`,
`tests/fixtures/qna/fixtures/*` (sample rooms).
**DoD:** Baseline ≥75% precision, ≥70% recall on seed set.
**Tests required:** Script smoke test.

---

## T-016 — Web: chat pane in the room view
Status: `[ ]`
**Scope:** `QnaChat` component — input, thread history, inline
citation renderers (clickable, open doc preview at anchor).
Conversation persistence.
**Files (likely):** `packages/web/app/room/_components/QnaChat.tsx`,
`packages/web/app/room/_components/CitationLink.tsx`.
**DoD:** AC-US1, AC-US3, AC-US4 pass.
**Tests required:** Playwright.

---

## T-017 — Web: external-user Opportunity chat
Status: `[ ]`
**Scope:** Same chat component rendered in `/external/:oppSlug`
context; retriever scope locked to the Opportunity.
**Files (likely):** `packages/web/app/external/[slug]/chat/page.tsx`.
**DoD:** AC-US2 passes (no cross-scope leak).
**Tests required:** Playwright.

---

## T-018 — Web: admin Q&A activity feed + exclusions
Status: `[ ]`
**Scope:** `/admin/qna` — activity feed (asker, question, top
citations); exclusions list + toggle per document from the
document detail page.
**Files (likely):** `packages/web/app/admin/qna/**/*.tsx`,
`packages/web/app/room/documents/[id]/_components/ExcludeFromQna.tsx`.
**DoD:** AC-US5, AC-US6 pass.
**Tests required:** Playwright.

---

## T-019 — Observability: metrics + alerts
Status: `[ ]`
**Scope:** Emit metrics per design.md §Observability; wire alarms.
**Files (likely):**
`microservices/core/infrastructure/metrics/qna.ts`,
`infra/observability.ts`.
**DoD:** Metrics observable; alarms fire on synthetic events.
**Tests required:** Smoke.

---

## T-020 — NFR hardening pass (security + perf)
Status: `[ ]`
**Scope:** Verify NFR1 (no third-party egress — net-test),
NFR2 (p95 ≤ 8s — perf test with 500-passage fixture),
NFR3 (citation resolvability — eval invariant),
NFR4 (model swap config-only — inspect),
NFR5 (indexing backlog alarm),
NFR6 (encryption at rest — DB inspect).
Property test: no passage from `org_b` ever surfaces in `org_a`
scope.
**Files (likely):** `tests/security/qna-nfr-matrix.spec.ts`,
`tests/perf/qna-p95.spec.ts`.
**DoD:** Matrix green in CI.

---

## T-021 — Playwright acceptance suite
Status: `[ ]`
**Scope:** One spec per AC-US1–AC-US6.
**Files (likely):** `tests/e2e/qna/*.spec.ts`.
**DoD:** All 6 specs green on e2e.

---

## T-022 — Slice sign-off + ADR-009
Status: `[ ]`
**Scope:** Draft ADR-009 (pgvector choice). Traceability matrix.
Tag `v0.6.0-ai-search-qna`.
**Files (likely):** `adr/009-pgvector.md`,
`docs/slices/ai-search-qna.md`.
**DoD:** ADR + matrix merged; tag pushed.

---

## Dependencies

```
T-001 ─► T-002 ─► T-006 ─► T-009 ─► T-013 ─► T-014 ─► T-016/17/18
         ▲        ▲        ▲                  ▲
T-003 ──►│        │        │                  │
T-004 ──►│        │        │                  │
T-005 ──►│        │        │                  │
                           │                  │
                 T-007 ────┤                  │
                 T-008 ────┤                  │
                 T-010 ────┤                  │
                 T-011 ────┘                  │
                 T-012 ─────────────────────► │

T-015 after T-012 (can run in parallel)
T-019, T-020 in parallel after T-014
T-021 after T-016–T-018
T-022 last
```

## Acceptance for the slice
1. All AC-US* in `requirements.md` pass in Playwright.
2. Eval harness baseline ≥75% precision, ≥70% recall, ≥95%
   i-don't-know correctness.
3. No passage leak between orgs or between Opportunities (property
   test green).
4. `v0.6.0-ai-search-qna` tagged.
