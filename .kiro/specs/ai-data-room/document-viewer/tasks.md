# Tasks — ai-data-room / document-viewer

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-31

Assumes `room-and-folders`, `access-control`, `tenant-isolation` merged.
Executes in `microservices/core`, a `microservices/workers` render worker, and
`packages/web`. Lands before `document-redaction`'s web task (it provides the
preview surface). 90% coverage gate.

---

## T-001 — Migrations + domain: document_renders

Status: `[ ]`
**Scope:** `document_renders` table (tenant-scoped) + domain types for render
status, page dims.
**Files (likely):** `packages/db/schema/viewer.ts`, migrations,
`microservices/core/domain/viewer/*`.
**DoD:** Migration applies; table scoped via `tenant-isolation` factory.
**Tests required:** Integration (apply + scoped query); schema unit tests.

---

## T-002 — Render worker: Office→PDF + rasterise

Status: `[ ]`
**Scope:** Headless LibreOffice conversion + PDF rasterise to per-page images;
write `page_dims`; emit page assets to the private prefix.
**Files (likely):** `microservices/workers/src/viewer/renderWorker.ts`,
`infra/*` (SQS, worker).
**DoD:** A DOCX and a PDF both produce paged image assets + correct dims.
**Tests required:** Integration — fixture DOCX/PDF render; dims match.

---

## T-003 — Infrastructure: render repo + page-asset S3 wrapper

Status: `[ ]`
**Scope:** `RenderRepo` via `scopedRepo`; S3 wrapper for page prefix; pre-signed
GET per page (≤5min).
**Files (likely):** `infrastructure/db/renderRepo.ts`,
`infrastructure/s3/renders.ts`.
**DoD:** Org-scoped; signed URLs scoped + TTL-bounded; in-prefix only.
**Tests required:** Unit (scoped); integration (S3 in-prefix).

---

## T-004 — Application: view resolve + authorise + cache

Status: `[ ]`
**Scope:** `GET /view` and `/view/page/:n` — authorise via `access-control`,
resolve original vs. rendition (`document-redaction` resolver), return cached
pages or enqueue render. Emit `document.viewed` audit.
**Files (likely):** `application/viewer/*`.
**DoD:** Authorised views only; redaction-scoped → rendition; audit emitted.
**Tests required:** Unit — auth matrix (role × tier), rendition routing,
no-original-for-view-only path; audit emitted.

---

## T-005 — Web: viewer shell + overlay slot

Status: `[ ]`
**Scope:** `<DocumentViewer>` component — progressive page canvas, lazy paging,
`overlay` composition slot, `initialPage`. View-only mode hides download/print.
**Files (likely):** `packages/web/src/components/DocumentViewer/*`.
**DoD:** Pages render progressively; overlay slot usable; view-only has no
download affordance.
**Tests required:** Component tests (render, paging, view-only state, overlay
mount point).

---

## T-006 — Integrations: Q&A citation deep-link

Status: `[ ]`
**Scope:** Wire `ai-search-qna` citation chips to open the viewer at the cited
page with region highlight via the overlay slot. (Redaction's region editor
consumes the same slot in its own slice.)
**Files (likely):** `packages/web/src/pages/*Qna*`, viewer overlay adapter.
**DoD:** Clicking a citation opens the source at the cited anchor highlighted.
**Tests required:** Component/integration — citation → viewer deep-link.

---

## T-007 — Observability + NFR hardening

Status: `[ ]`
**Scope:** Render/first-page latency + cache-hit + failure metrics; alarms;
no-cache headers; tenant-scope hardening pass.
**Files (likely):** `infrastructure/observability/metrics.ts`, `infra/*`.
**DoD:** Metrics emit; alarms wired; NFR matrix complete.
**Tests required:** Unit — metric emission; security assertions.

---

## T-008 — Playwright acceptance + slice sign-off

Status: `[ ]`
**Scope:** E2E: open PDF + DOCX in-app; view-only external user has no download;
citation deep-link. Traceability matrix; sign-off; tag.
**Files (likely):** `e2e/specs/document-viewer/*`,
`docs/slices/document-viewer.md`.
**DoD:** E2E green; matrix complete; sign-off merged.
**Tests required:** Playwright suite; CI green.
