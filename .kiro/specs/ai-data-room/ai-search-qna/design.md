# Design — ai-data-room / ai-search-qna

**Status:** draft
**Requirements:** [./requirements.md](./requirements.md)
**Last updated:** 2026-04-21
**Depends on:** `room-and-folders`, `access-control`, (soft)
`doc-checklist` + `ai-doc-sensecheck`

## Summary
pgvector in-VPC for storage; a dedicated `indexer` worker fed by
EventBridge on approval events; a synchronous `query` handler that
(1) expands the question into an embedding, (2) ANN-searches, (3)
**filters by the user's access scope before any passages reach the
model**, (4) prompt-re-ranks top-50 → top-10, (5) calls Claude
Sonnet 4.6 with strict citation rules, (6) persists a conversation
turn + audit event. No third-party vector store; no cross-org
search; no model-only fallback.

## Architecture

```mermaid
flowchart LR
  Checklist[ai-doc-sensecheck<br/>slot.approved]
  RoomFolders[room-and-folders<br/>softDelete]
  AccessControl[access-control<br/>authorise()]

  subgraph AWS["AWS (in-VPC)"]
    Events[EventBridge]
    IndexQueue[SQS<br/>qna-index-jobs]
    Indexer[Lambda<br/>indexer-worker]
    Extract[Text extractor<br/>per-page]
    Embed[Embedding caller<br/>Voyage via Anthropic or Bedrock Titan]
    PG[(Postgres + pgvector<br/>passages, conversations,<br/>turns, exclusions)]
    S3[(S3 docs bucket)]
    Metrics[CloudWatch]
  end

  API[API handler<br/>POST /qna/ask]
  Anthropic[Anthropic API<br/>Claude Sonnet 4.6]

  Checklist -->|emit| Events
  RoomFolders -->|emit| Events
  Events --> IndexQueue
  IndexQueue --> Indexer
  Indexer --> S3
  Indexer --> Extract
  Extract --> Embed
  Embed --> PG

  API --> AccessControl
  API --> Embed
  Embed --> PG
  API --> Anthropic
  Anthropic --> API
  API --> PG
  API --> Metrics
```

## Data model

### `qna_passages`
One row per chunked passage. Source of truth for retrieval.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Passage id; used as citation token. |
| `org_id` | `uuid` FK | Scoped retrieval + security. |
| `document_id` | `uuid` FK `documents.id` | |
| `document_version_id` | `uuid` FK `document_versions.id` | |
| `opportunity_id` | `uuid` nullable FK | For Opportunity-scoped docs. |
| `canonical_folder` | `text` nullable | For canonical-folder docs. |
| `anchor` | `jsonb` | `{kind: 'page'|'slide'|'sheet', number, offsetStart, offsetEnd}`. |
| `text` | `text` | The chunk, for the prompt + display snippet. |
| `token_count` | `int` | Sanity check. |
| `embedding` | `vector(1024)` | pgvector type; dim from embedding model. |
| `embedded_model` | `text` | e.g. `voyage-3` or `bedrock-titan-v2`. |
| `indexed_at` | `timestamptz` | |

Indexes:
- `HNSW (embedding) WITH (m=16, ef_construction=64)` for ANN.
- `(document_id)` for cascade delete.
- `(org_id, opportunity_id, canonical_folder)` for candidate pre-filter.

### `qna_conversations`
A user's chat thread within a room / Opportunity scope.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `org_id` | `uuid` FK | |
| `owner_user_id` | `uuid` FK `users.id` | |
| `scope_kind` | `enum('room','opportunity')` | |
| `opportunity_id` | `uuid` nullable FK | Non-null for external-user scope. |
| `created_at` / `updated_at` | `timestamptz` | |

### `qna_turns`
Append-only conversation turns.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `conversation_id` | `uuid` FK | |
| `role` | `enum('user','assistant')` | |
| `question` | `text` nullable | Only for user turns. |
| `answer` | `text` nullable | Only for assistant turns. |
| `citations` | `jsonb` | `Array<{passageId, docId, anchor, snippet}>`. |
| `unanswered_reason` | `text` nullable | |
| `model_id` / `prompt_version` | `text` | |
| `input_tokens` / `output_tokens` | `int` | |
| `latency_ms` | `int` | |
| `truncated` | `boolean` | |
| `created_at` | `timestamptz` | |

Index: `(conversation_id, created_at)` for thread rendering.

### `qna_exclusions`
Admin-flagged documents excluded from Q&A (FR11).

| Column | Type | Notes |
|---|---|---|
| `org_id` | `uuid` FK | |
| `document_id` | `uuid` PK (part) FK | |
| `excluded_by` | `uuid` FK `users.id` | |
| `excluded_at` | `timestamptz` | |
| `reason` | `text` nullable | |

On insert, trigger a cascade delete of the doc's passages within
5 minutes (FR3 + AC-US6).

### `qna_usage_counters`
Per-org monthly counters for FR15.

| Column | Type | Notes |
|---|---|---|
| `org_id` | `uuid` PK part | |
| `year_month` | `char(7)` PK part | |
| `questions` | `int` default 0 | |
| `last_updated_at` | `timestamptz` | |

## Indexing pipeline

### Triggers (EventBridge → SQS)
- `slot.approved` (from `ai-doc-sensecheck`) → enqueue index.
- `document.softDeleted` (from `room-and-folders`) → enqueue delete.
- `slot.rejected` / `slot.reset` → enqueue delete.
- `qna.exclusion.added` → enqueue delete.
- `qna.exclusion.removed` → enqueue index.

### Indexer worker
1. Download document from S3.
2. Extract text per-page using the same module as `ai-doc-sensecheck`
   (`infrastructure/sensecheck/extract.ts` — shared, not duplicated).
3. For each page, chunk into overlapping ~1,000-token passages
   (~200-token overlap) respecting paragraph boundaries where
   possible.
4. Batch-embed via the embedding provider. **Default at v0.1:
   Voyage via Anthropic's `voyage-3` model** (under the Anthropic
   umbrella to maintain the NFR1 boundary). Fallback in infra
   configuration to AWS Bedrock Titan v2 if policy changes.
5. Upsert `qna_passages` rows. Previous version's passages are
   deleted in the same transaction (version-aware cleanup).
6. Emit `qna.indexed` event.

### Delete path
Simple `DELETE FROM qna_passages WHERE document_id = $1`. Idempotent.

### Backlog SLA
`indexing.backlog_age_seconds` gauge; alarms on >600s (NFR5).

## Query flow

### HTTP contract
`POST /orgs/:orgId/qna/ask`
```json
{
  "conversationId": "uuid | null",
  "scope": { "kind": "room" | "opportunity", "opportunityId": "uuid?" },
  "question": "..."
}
```
Returns:
```json
{
  "conversationId": "uuid",
  "turnId": "uuid",
  "answer": "...",
  "citations": [
    { "passageId": "...", "docId": "...", "anchor": {...}, "snippet": "..." }
  ],
  "unansweredReason": null,
  "truncated": false
}
```

### Steps (API handler, sync)
1. Rate-limit check (per-user 20/min; per-org monthly ≤2,000).
2. Authorise — confirm the user can read *any* document in the
   requested scope.
3. Embed question via the same embedding model; **prepend the
   last 3 user + 3 assistant turns** to the embed input when
   `conversationId` present (FR7).
4. Candidate recall — ANN query against `qna_passages`:
   ```sql
   SELECT id, document_id, anchor, text
   FROM qna_passages
   WHERE org_id = $1
     AND (
       (scope = 'room' AND <role-based candidate filter>)
       OR (scope = 'opportunity' AND opportunity_id = $2)
     )
     AND document_id NOT IN (SELECT document_id FROM qna_exclusions WHERE org_id = $1)
   ORDER BY embedding <=> $queryEmbedding
   LIMIT 50;
   ```
5. **Access-control filter (per-passage)** — re-run
   `authorize(session, {kind:'document', docId}, 'read')` over the
   50 candidates. Drop any that deny. This is FR6 — and it's a
   defence-in-depth layer on top of the SQL scope filter so a bug
   in the candidate filter cannot leak cross-scope passages.
6. Prompt-based re-rank — send the remaining candidates + the
   question to Claude Haiku 4.5 with a re-rank prompt that returns a
   top-10 ordering. This keeps the re-ranker model-agnostic and
   removes a hosting burden; cheaper + simpler than a cross-encoder
   at v0.1.
7. Context budget — feed the top-N passages (up to 8, cumulative
   ≤16k tokens) into the answer generator.
8. **Answer generator** — Claude Sonnet 4.6 with a strict
   citation-only prompt (see §Prompt design). Output JSON.
9. Persist turn + citations + usage. Increment counters. Emit
   audit event + `qna.answered` metric.
10. If retriever returned zero candidates, skip steps 6–8 and
    return FR10's "couldn't find anything in your scope" answer
    directly.

### Latency budget (NFR2)
| Step | Target ms |
|---|---|
| Rate + auth | 20 |
| Embed | 250 |
| ANN | 150 |
| Access filter (cached) | 40 |
| Re-rank (Haiku) | 800 |
| Generator (Sonnet) | 4,500 |
| Persist | 100 |
| **Total p95** | **≤ 6,000** |

Leaves headroom vs. NFR2 p95 ≤ 8s.

## Prompt design

Prompts versioned in code at
`microservices/core/domain/qna/prompts/`:
- `retriever-rerank-v1.ts`
- `answer-generator-v1.ts`

Answer generator key rules:
- Must output JSON matching `AnswerSchema` (`answer`, `citations`,
  `unanswered_reason`).
- Every factual claim in `answer` must include an inline `[cN]`
  marker matching `citations[N]`. Zod validator rejects if any
  `[cN]` doesn't have a matching citation and vice-versa.
- If none of the provided passages support the answer:
  `{ answer: "I couldn't find anything in the documents you have access to that answers this.", citations: [], unanswered_reason: "no_supporting_passage" }`.
- Never fabricate anchors; citations must come from the `passageId`s
  we supplied. Evaluator in T-014 checks this invariant.

## Interfaces

All under `/orgs/:orgId/qna/`. All behind `requires(...)`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/qna/ask` | Single round-trip ask. Returns a turn. |
| `POST` | `/qna/conversations` | Explicit new conversation (optional). |
| `GET` | `/qna/conversations` | List a user's own. |
| `GET` | `/qna/conversations/:id` | Full thread. |
| `DELETE` | `/qna/conversations/:id` | User deletes their own thread. |
| `GET` | `/qna/exclusions` | Admin: list excluded docs. |
| `POST` | `/qna/exclusions` | Admin: flag a doc (body `{documentId, reason?}`). |
| `DELETE` | `/qna/exclusions/:documentId` | Admin: un-exclude. |
| `GET` | `/qna/activity` | Admin: activity feed (asker, question, top-3 citations). |
| `GET` | `/qna/usage` | Monthly counter + remaining. |

## Key trade-offs

- **pgvector over dedicated vector DB** — fewer moving parts, same
  Postgres we already run, simpler per-row access-control scoping
  (just a SQL predicate). Accept the operational ceiling (~10M
  passages on a reasonably-sized db before HNSW build costs bite).
  → [ADR-009](../../../adr/009-pgvector.md) *(to be drafted)*

- **Prompt-based re-ranker (Haiku) over self-hosted cross-encoder**
  — zero hosting + upgradable by model swap. Haiku re-rank adds
  ~800ms but removes a whole component. Revisit at scale.

- **Double access filter (SQL + post-retrieval)** — intentional
  belt-and-braces. The SQL filter is fast; the authorize() call
  is authoritative. If either fails, the other catches it. No
  cross-scope leak should be possible in v0.1. This is the single
  most important security invariant for the slice.

- **Embeddings via Voyage (Anthropic) rather than OpenAI** — NFR1
  + vendor consistency with the rest of our AI stack.

- **Sonnet 4.6 for generator, Haiku 4.5 for re-ranker** — quality
  on answer generation matters more than latency; re-ranking is
  latency-sensitive but quality-tolerant.

- **Conversation memory via retriever expansion, not model memory**
  — we inject prior turns into the embed input, but the generator
  sees only the current question + passages (not prior assistant
  answers). Keeps cost bounded and prevents the model from
  doubling-down on past hallucinations.

## Security

- **Cross-scope leak prevention** — §Query flow step 5 is the
  critical invariant. Unit + property tests enforce that no
  passage with `org_id ≠ session.org_id` can ever appear in a
  response, and no passage outside the asker's grant scope
  either. Part of NFR hardening in T-020.
- **Opportunity isolation** — external users' `session.scope` pins
  retrieval to a single Opportunity FK. Room-wide queries are
  rejected with 403 for external users.
- **Passage text at rest** — encrypted via Postgres TDE + KMS.
- **Audit trail** — every `qna/ask` creates an audit event carrying
  the full question text (FR13). Redaction: none at v0.1 — the
  question is part of the compliance story. Admin can export the
  audit log per-org.
- **Prompt injection** — passage text is untrusted input. Generator
  prompt frames passages as "untrusted document content" and
  refuses to follow embedded instructions. Zod output schema
  prevents response hijack.

## Observability

**Logs:** `conversationId, turnId, userId, orgId, scope, numCandidates,
numAfterAccessFilter, numInPrompt, answered, unansweredReason, latencyMs,
model, promptVersion`.

**Metrics:**
- `qna.questions{scope,answered}` — count.
- `qna.i_dont_know.rate` — ratio (rolling 7d).
- `qna.citations_per_answer` — histogram.
- `qna.latency_ms{stage}` — histogram, stages = embed|ann|rerank|gen.
- `qna.candidates_filtered_out` — histogram. High values hint at
  SQL-filter bugs.
- `qna.backlog.indexing_age_seconds` — gauge.
- `qna.exclusions.count` — gauge.

**Alerts:**
- `qna.i_dont_know.rate > 60% over 24h` — likely missing embeddings
  or broken retrieval.
- `qna.backlog.indexing_age_seconds > 600` — NFR5.
- `qna.latency_ms.p95 > 8000 over 30min` — NFR2.

## Eval harness (minimal v0.1)

`bun run eval:qna` CLI parallel to sensecheck:
1. Loads a golden set of `(room_fixture, question, expectedDocIds,
   expectedAnchors, shouldAnswer)`.
2. Runs the full pipeline.
3. Reports answer precision (correct doc cited), recall (correct
   anchor cited), I-don't-know correctness.
4. Snapshot committed; CI runs on changes to prompts or indexer.

## Rollout

Feature flag `qna_enabled` per-org. Phased:
1. **Internal Capital Pay pilot** — flag on, light use.
2. **Early-access** — first 5 orgs, monitor latency + recall.
3. **GA** — default on.

Migrations: `qna_passages` (+HNSW index), `qna_conversations`,
`qna_turns`, `qna_exclusions`, `qna_usage_counters`.

## Open questions

- **Embedding dim** — Voyage-3 is 1024; if we swap to Bedrock Titan
  v2 (1024) or another, schema change. Pinning at 1024 for both
  keeps us flexible.
- **Follow-up question detection** — do we auto-detect topic-shift
  in a conversation to reset the retriever? Leaning **no at v0.1**;
  just expand embeds with prior turns. Revisit if eval shows
  drift.
- **Opportunity-internal cross-folder scope** — when an external
  user asks, do we include canonical-folder docs their grant
  covers (e.g. "shared with vendors" from Opportunity config)?
  v0.1 says **no** — external = Opportunity-only, strict. Phase 2
  adds per-grant folder overlays.

## Sign-off
- [ ] Bradley reviewed
- [ ] Tasks phase unblocked
