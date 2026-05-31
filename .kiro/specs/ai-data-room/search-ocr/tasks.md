# Tasks — ai-data-room / search-ocr

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-31

Assumes `room-and-folders`, `ai-doc-sensecheck` (shared extractor), and
`tenant-isolation` merged. Best landed alongside or just after `ai-search-qna`
(shares the indexing bus). Executes in `microservices/core`,
`microservices/workers`, `packages/db`, `packages/web`. 90% coverage gate.

---

## T-001 — Migrations + domain: fts_pages

Status: `[ ]`
**Scope:** `fts_pages` (tenant-scoped) with generated `tsvector` + GIN index +
scope indexes; domain types; confirm share-vs-separate-from-`qna_passages`.
**Files (likely):** `packages/db/schema/search.ts`, migrations (hand-written
DDL for the generated column + GIN — note why), `microservices/core/domain/search/*`.
**DoD:** Migration applies; GIN index present; scoped via `tenant-isolation`.
**Tests required:** Integration (apply + FTS query returns ranked rows).

---

## T-002 — OCR step in the index pipeline

Status: `[ ]`
**Scope:** Detect no-text pages; route page image to the chosen in-VPC OCR
engine; write recovered text + `text_source`/`ocr_status`; fail-safe on error;
backlog gauge. Resolve Textract vs. Tesseract here.
**Files (likely):** `microservices/workers/src/search/ocrStep.ts`,
shared extractor integration, `infra/*`.
**DoD:** A scanned-PDF fixture yields OCR text; failure marks `ocr_failed`,
never blocks; OCR'd text reaches the qna indexer.
**Tests required:** Integration — scanned fixture → text; failure path safe.

---

## T-003 — Index worker: populate + maintain fts_pages

Status: `[ ]`
**Scope:** Subscribe the same approval/change/delete events; upsert `fts_pages`
per page; version-aware cleanup; delete on doc removal within the backlog SLA.
**Files (likely):** `microservices/workers/src/search/indexWorker.ts` (or extend
the qna indexer), `infra/*`.
**DoD:** Index reflects current docs; removal purges within SLA.
**Tests required:** Integration — upsert, version replace, delete.

---

## T-004 — Application: scope-filtered search query

Status: `[ ]`
**Scope:** `GET /search` — rate-limit, authorise, scope predicate, `tsquery` +
`ts_rank` + `ts_headline`, per-doc authorise (double filter), operators +
filters, deep-link payload to `document-viewer`.
**Files (likely):** `application/search/*`.
**DoD:** Ranked, highlighted, scope-correct results; external users pinned to
their opportunity.
**Tests required:** Unit — ranking, operators, scope; **property test** — no
cross-scope result.

---

## T-005 — Application: OCR-health admin view

Status: `[ ]`
**Scope:** `GET /search/ocr-health` listing documents with `ocr_failed` pages,
admin-only.
**Files (likely):** `application/search/ocrHealth.ts`.
**DoD:** Lists failed-OCR docs; admin-only.
**Tests required:** Unit — listing + auth.

---

## T-006 — Web: unified search bar + results

Status: `[ ]`
**Scope:** Search bar with "search" / "ask" modes; results list with snippet +
deep-link into the viewer; OCR-health panel in admin.
**Files (likely):** `packages/web/src/components/Search/*`,
`packages/web/src/pages/Search.tsx`.
**DoD:** Keyword results render + deep-link; mode toggle to Q&A works.
**Tests required:** Component tests (results, deep-link, mode toggle).

---

## T-007 — Observability + NFR hardening

Status: `[ ]`
**Scope:** Search/OCR metrics + alarms (backlog, latency); tenant-scope +
double-filter hardening pass.
**Files (likely):** `infrastructure/observability/metrics.ts`, `infra/*`.
**DoD:** Metrics emit; alarms wired; NFR matrix complete.
**Tests required:** Unit — metric emission; scope assertions.

---

## T-008 — Playwright acceptance + slice sign-off

Status: `[ ]`
**Scope:** E2E: keyword search returns a scanned doc post-OCR; external user
scope-limited; result opens viewer at page. Traceability matrix; sign-off; tag.
**Files (likely):** `e2e/specs/search-ocr/*`, `docs/slices/search-ocr.md`.
**DoD:** E2E green; matrix complete; sign-off merged.
**Tests required:** Playwright suite; CI green.
