# Design — ai-data-room / search-ocr

**Status:** draft
**Requirements:** [./requirements.md](./requirements.md)
**Last updated:** 2026-05-31
**Depends on:** `room-and-folders`, `ai-doc-sensecheck` (shared extractor),
`tenant-isolation`; complements `ai-search-qna`

## Summary

Two coordinated additions to the existing ingestion pipeline: (1) an **OCR
step** that runs when a page has no extractable text, producing a text layer
that feeds the shared extractor every AI consumer already uses; and (2) a
**Postgres full-text search** index + scope-filtered API for keyword lookup
that sits beside (not instead of) semantic Q&A. Both reuse the EventBridge→SQS
indexing pattern and the double access-filter from `ai-search-qna`.

## Architecture

```mermaid
flowchart LR
  Up[document approved/changed] --> EB[EventBridge]
  EB --> Q[SQS index-jobs]
  Q --> W[Lambda index-worker]
  W --> Extract[shared extractor]
  Extract -->|page has text| FTS[(fts_pages tsvector)]
  Extract -->|no text| OCR[OCR engine in-VPC]
  OCR --> FTS
  OCR --> Back[feeds qna indexer + sensecheck + redaction]
  Search[GET /search] --> AC[scope predicate + authorise]
  AC --> FTS
  FTS --> Rank[ts_rank + highlight]
  Rank --> Search
```

## Data model

### `fts_pages`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `org_id` | `uuid` FK | tenant-scoped. |
| `document_id` | `uuid` FK | |
| `document_version_id` | `uuid` FK | |
| `opportunity_id` | `uuid` nullable | scope. |
| `canonical_folder` | `text` nullable | scope. |
| `page` | `int` | |
| `text` | `text` | extracted or OCR'd page text. |
| `tsv` | `tsvector` | generated from `text` (language config `english`). |
| `text_source` | `enum('native','ocr')` | provenance. |
| `ocr_status` | `enum('n/a','ok','failed')` | for the health view. |
| `indexed_at` | `timestamptz` | |

Indexes: `GIN (tsv)` for FTS; `(org_id, opportunity_id, canonical_folder)` for
the scope pre-filter; `(document_id)` for cascade delete.

## OCR step

- The index-worker extracts text per page via the shared extractor. If a page
  yields no usable text, it routes the page image to the OCR engine (in-VPC),
  writes the recovered text with `text_source='ocr'`, and on failure sets
  `ocr_status='failed'` (page still indexed-as-empty; document never blocked —
  FR2).
- OCR'd text flows back to the **same** downstream consumers: the `ai-search-qna`
  passage indexer, `ai-doc-sensecheck` classification, and
  `document-redaction` suggestion — so a scanned doc reaches parity (FR3).
- Backlog gauge `ocr.backlog_age_seconds`, alarmed >600s (NFR2).

## Keyword search flow

`GET /orgs/:orgId/search?q=...&folder=...&opportunityId=...&type=...`

1. Rate-limit + authorise the scope.
2. Build the scope predicate (role-based, exactly like `ai-search-qna` step 4).
3. `tsquery` over `tsv` with `ts_rank`; return top-N documents with the best
   page + `ts_headline` snippet.
4. **Per-doc authorise** the candidates (the second of the double filter) before
   returning — defence in depth against a scope-predicate bug (FR6).
5. Results deep-link into `document-viewer` at the matching page.

## Interfaces

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/search` | Keyword search (scope-filtered, ranked, highlighted). |
| `GET` | `/search/ocr-health` | Admin: documents with `ocr_failed` pages. |

A unified search bar in the web app offers two modes — "search" (this slice)
and "ask" (`ai-search-qna`) — over the same scope.

## Security

- **Double scope filter** (FR6) — SQL predicate + per-doc authorise, mirroring
  the Q&A invariant; property-tested for no cross-scope result.
- **Tenant isolation** — `fts_pages` scoped via `tenant-isolation`.
- **In-VPC OCR** (NFR4) — document bytes never leave the boundary.
- **External users** are pinned to a single Opportunity scope (room-wide search
  rejected with 403), same as Q&A.

## Observability

- **Metrics:** `search.queries{scope}`, `search.latency_ms`,
  `search.zero_result_rate`, `ocr.pages{source,status}`,
  `ocr.backlog_age_seconds`.
- **Alerts:** `ocr.backlog_age_seconds > 600`; `search.latency_ms p95 > 400`.
- **Logs:** `orgId, scope, q-hash, numResults, latencyMs`.

## Key trade-offs

- **Postgres FTS over a dedicated search engine (Elastic/OpenSearch).** Same DB
  we already run, same per-row scoping as pgvector, far fewer moving parts.
  Accept the ceiling; revisit if scale or relevance needs demand it.
- **Reuse the shared extractor + indexing bus.** OCR is an *augmentation* of the
  existing pipeline, not a parallel one — one source of truth for page text
  across sense-check, Q&A, search, redaction.
- **Keyword beside semantic, not instead.** Users want both "find the file with
  X" and "answer my question"; conflating them weakens both.

## Open questions

- Textract vs. Tesseract (cost/quality/boundary) — resolve in T-002.
- Share page text with `qna_passages` (one source row) vs. a separate
  `fts_pages` table (chosen here for index independence). Confirm in T-001.
- Per-language `tsvector` config beyond English — defer unless the pilot needs
  it.

## Sign-off

- [ ] Bradley reviewed
- [ ] Tasks phase unblocked
