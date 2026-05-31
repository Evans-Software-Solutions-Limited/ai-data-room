# Requirements — ai-data-room / search-ocr

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-05-31
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `room-and-folders` (documents + upload pipeline),
`ai-doc-sensecheck` (shared text extractor); complements `ai-search-qna`

## Context

`ai-search-qna` gives semantic, cited answers, but two capabilities every
incumbent ships are still missing: **OCR** (so scanned / image-only PDFs become
text at all) and **classic keyword / full-text search** (exact-match lookup
across the room). Without OCR, a scanned contract or photographed document is
invisible to sense-check, Q&A *and* redaction — a silent quality cliff. Without
keyword search, users can't do the "just find me the file that mentions X"
lookup that complements AI answers. This slice delivers both: an OCR step in
the ingestion pipeline and a Postgres full-text search index + API.

## Users & roles

- **Primary:** internal users searching for a document or a phrase.
- **Secondary:** external viewers searching within their Opportunity scope.
- **Roles (from `auth-and-orgs`):** all roles; results are scope-filtered
  exactly as `ai-search-qna` results are.

## User stories

- **US1** — _As a user, I want to type a keyword and get the documents and pages
  that contain it, ranked, so I can jump straight to a file._
- **US2** — _As an owner, I want scanned/photographed PDFs to be searchable and
  answerable, so the room doesn't have silent blind spots._
- **US3** — _As an external viewer, I want keyword search restricted to my
  Opportunity scope, never the host room._
- **US4** — _As an admin, I want to see which documents failed OCR so I can
  re-upload a better copy._

## Functional requirements

### OCR

- **FR1** — On document ingestion, if a page has no usable extractable text
  (scanned/image), the system shall run OCR to produce a text layer, feeding the
  **same shared extractor** that `ai-doc-sensecheck` and `ai-search-qna` use.
- **FR2** — OCR shall run async (it must never block upload completion) and
  shall fail safe: an OCR failure marks the page `ocr_failed` and leaves the
  document usable, never blocked.
- **FR3** — OCR output shall feed downstream consumers (sense-check
  classification, Q&A indexing, keyword index, redaction suggestion) so a
  scanned doc gains parity with a native-text doc.

### Keyword / full-text search

- **FR4** — The system shall maintain a Postgres full-text index over extracted
  + OCR'd document text, scoped by `org_id` (and opportunity/folder).
- **FR5** — A search API shall accept a query string and return matching
  documents with the matching page(s) and a highlighted snippet, ranked by
  relevance (`ts_rank` or equivalent).
- **FR6** — Search results shall be **scope-filtered** with the same
  double-filter discipline as `ai-search-qna` (SQL scope predicate + per-doc
  authorise) so no out-of-scope document ever appears.
- **FR7** — Search shall support basic operators (quoted phrases, exclusion)
  and filter by folder / opportunity / file type.
- **FR8** — Admins shall see an OCR-health view: documents with `ocr_failed`
  pages.

## Non-functional requirements

- **NFR1** — Keyword search over ≤100k indexed pages in one org shall return in
  ≤400ms p95.
- **NFR2** — OCR backlog age shall be alarmed (>600s) like the Q&A indexer.
- **NFR3** — Search and OCR text shall be tenant-scoped (`tenant-isolation`);
  no cross-org leak — proven by the same property-test discipline.
- **NFR4** — OCR shall run in-VPC (no third-party egress of document bytes),
  consistent with the AI-vendor boundary stance.
- **NFR5** — The full-text index shall update within the same backlog SLA as
  Q&A indexing when a document changes or is removed.

## Acceptance criteria

- **AC-US1** — A keyword search returns ranked documents + pages + highlighted
  snippets; clicking a result opens the doc (via `document-viewer`) at the page.
- **AC-US2** — A scanned-PDF upload becomes searchable and Q&A-answerable after
  OCR completes; before completion it is simply not-yet-indexed, never blocked.
- **AC-US3** — An external viewer's keyword search returns only their
  Opportunity's documents; a property test proves no cross-scope result.
- **AC-US4** — A document with an unreadable page shows as `ocr_failed` in the
  admin OCR-health view.
- **AC-US5** — Removing/soft-deleting a document removes it from search results
  within the backlog SLA.

## Non-goals (for this slice)

- Semantic / vector search and cited answers → owned by `ai-search-qna` (this
  slice is keyword + OCR feeding it).
- Handwriting recognition / low-quality-scan enhancement → Phase 2.
- Cross-org / platform-wide search → never (isolation).
- Translated search across languages → Phase 2.

## Open questions

- OCR engine: in-VPC Tesseract (free, decent) vs. AWS Textract (better on
  tables/forms, managed, stays in-AWS). Leaning Textract if it stays within the
  data-boundary policy; Tesseract fallback. Resolve in design.
- Do we expose keyword search and Q&A as one unified search bar (keyword +
  "ask") or two surfaces? Leaning one bar, two modes, at the UI layer.
- Index granularity: per-page rows (reuse `qna_passages` source text) vs. a
  dedicated FTS table. Resolve in design.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
