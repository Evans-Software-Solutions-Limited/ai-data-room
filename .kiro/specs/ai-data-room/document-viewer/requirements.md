# Requirements — ai-data-room / document-viewer

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-05-31
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `room-and-folders`, `access-control`
**Prerequisite for:** `document-redaction` (region drawing); enhances
`ai-search-qna` (citation → source view)

## Context

The brief deferred an in-app viewer to Phase 2, but two committed features now
depend on rendering documents in the browser: `document-redaction` needs a
preview surface to draw redaction regions on, and `ai-search-qna`'s citation
auditability is far stronger if a citation can open its source document at the
cited anchor rather than only showing a snippet. This slice delivers a
**read-only, secure, in-app viewer** for the supported file types — no
download required, scope-enforced, watermark-ready.

## Users & roles

- **Primary:** internal users reviewing documents and (via redaction) preparing
  them for sharing.
- **Secondary:** external viewers reading scoped documents without downloading.
- **Roles (from `auth-and-orgs`):** all roles; what each can view is decided by
  `access-control`. The viewer renders only what the caller is authorised to
  see (and, where redaction applies, only the rendition).

## User stories

- **US1** — _As an internal user, I want to open a document in the browser and
  read it without downloading, so sensitive files don't proliferate to local
  disks._
- **US2** — _As an admin preparing a redaction, I want a faithful page-by-page
  preview I can draw regions on._
- **US3** — _As a user reading a Q&A answer, I want to click a citation and see
  the source document open at the cited page/region._
- **US4** — _As an external viewer with view-only access, I want to read a
  document in-app but not download it._
- **US5** — _As a compliance owner, I want in-app views recorded in the audit
  log just like downloads._

## Functional requirements

- **FR1** — The viewer shall render the supported types from `room-and-folders`
  (PDF, DOCX, XLSX, PPTX, PNG, JPG, CSV, TXT). Office formats are rendered via a
  server-side conversion to PDF/image for display; the original is never shipped
  to the browser for view-only access.
- **FR2** — Rendering shall be **page-addressable**: a caller can request "open
  document D at page N" (and, for redaction, retrieve page dimensions for
  region anchoring).
- **FR3** — View access shall be authorised through `access-control` on every
  request; the viewer shall never render a document the caller cannot read, and
  shall render the **redacted rendition** (not the original) for
  redaction-scoped viewers (`document-redaction` FR8).
- **FR4** — View-only access (the `viewer` tier in `access-control`) shall not
  expose a download/print affordance or a retrievable original-bytes URL.
- **FR5** — Rendered page assets shall be served via short-TTL pre-signed URLs
  scoped to the session, the same way downloads are (≤5 min TTL).
- **FR6** — The viewer shall emit a `document.viewed` audit event (with page
  range where available) via the `auth-and-orgs` audit writer.
- **FR7** — The viewer shall expose a stable hook for an overlay layer
  (redaction region drawing in `document-redaction`; citation highlight in
  `ai-search-qna`) so those slices compose on top without forking the viewer.

## Non-functional requirements

- **NFR1** — First page of a ≤50-page PDF shall render in ≤1.5s p95
  (progressive page load; later pages stream).
- **NFR2** — Rendered assets shall be tenant-scoped (`tenant-isolation`) and
  encrypted at rest; no cross-org asset is ever reachable.
- **NFR3** — The render pipeline shall not preclude later dynamic watermarking
  (`watermark-preview-drm`, Phase 2) — the page-image step is the insertion
  point.
- **NFR4** — View-only assets shall carry no-cache headers and shall not be
  trivially scrapeable into a reconstructed original (best-effort at v0.1; true
  DRM is Phase 2).

## Acceptance criteria

- **AC-US1** — An internal user opens a PDF in-app and pages through it without
  any file downloading to disk.
- **AC-US2** — Opening a DOCX renders a faithful paginated view; an admin can
  read page dimensions needed to anchor a redaction region.
- **AC-US3** — Clicking a Q&A citation opens the source document at the cited
  page with the cited region highlighted.
- **AC-US4** — A `viewer`-tier external user can read but has no download/print
  control and no API path to original bytes.
- **AC-US5** — Each open emits a `document.viewed` audit event with the page
  range.

## Non-goals (for this slice)

- Dynamic per-viewer watermarking / fence-view / true DRM → Phase 2.
- In-browser editing / annotation persistence (beyond the redaction overlay
  owned by `document-redaction`).
- Collaborative simultaneous viewing / presence.
- Audio/video playback.

## Open questions

- Office→PDF conversion: server-side LibreOffice/headless vs. a managed
  conversion service. Leaning headless LibreOffice in a worker (no per-doc
  egress to third parties; keeps the NFR1 AI-vendor-style boundary).
- Do we pre-render on upload (faster first view, more storage) or on first view
  (lazy, cheaper)? Leaning lazy-with-cache at v0.1.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
