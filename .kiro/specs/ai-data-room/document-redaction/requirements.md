# Requirements — ai-data-room / document-redaction

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-05-31
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `room-and-folders` (documents + versions + download path),
`access-control` (viewer tiers + download gate); soft-depends on
`ai-doc-sensecheck` (shared extraction pipeline for the AI-assist half)
**Positioning:** [../../../docs/product/positioning.md](../../../docs/product/positioning.md)

## Context

Every incumbent VDR (Ideals, Datasite, Ansarada, Drooms, Imprima) ships
document redaction, and most now ship **AI-assisted** redaction. Our specs
currently cover only _log_ redaction — there is no way to black out sensitive
content in a document before an external party sees it. For the
vendor/RFP/security-pack wedge this is table stakes: a customer sharing
financials or contracts with a counterparty must be able to redact salaries,
bank details, third-party PII, or unrelated commercial terms.

This slice delivers redaction in two halves that ship in order:

1. **Manual redaction (MVP-critical):** an owner/admin draws redaction regions
   on a document; the system produces an irreversibly-flattened redacted
   rendition that is what scoped external viewers receive.
2. **AI-assisted suggestion (differentiator):** Claude proposes regions likely
   to need redaction (PII, account numbers, names) which a human confirms —
   reusing the `ai-doc-sensecheck` extraction pipeline. Suggestions are never
   auto-applied.

The critical security property: a viewer entitled only to the redacted version
must **never** be able to obtain the original bytes.

## Users & roles

- **Primary user:** owner/admin preparing a document for external sharing.
- **Secondary:** internal contributor proposing redactions for admin approval.
- **Consumer:** external viewer who receives only the redacted rendition.
- **Roles (from `auth-and-orgs`):** `owner`, `admin`, `internal`, `external`.
  Only `owner`/`admin` can apply or approve redactions; `external` never sees
  unredacted bytes of a redacted document.

## User stories

- **US1** — _As an admin, I want to draw black-out regions on a document's
  preview so sensitive content is hidden before I share it externally._
- **US2** — _As an admin, I want the redacted version that external viewers
  download to have the hidden content actually removed from the file, not just
  visually covered, so it can't be recovered._
- **US3** — _As an admin, I want the AI to suggest regions likely to need
  redaction (PII, account numbers) so I don't miss anything, while I stay the
  one who confirms._
- **US4** — _As an admin, I want to see and edit existing redactions on a
  document and re-publish a new redacted version._
- **US5** — _As a compliance owner, I want every redaction action and every
  external download of a redacted document in the audit log._
- **US6** — _As an external viewer, I want to open the document I'm entitled to
  and only ever see the redacted version._

## Functional requirements

### Manual redaction

- **FR1** — Owners/admins shall be able to define one or more **redaction
  regions** on a document, anchored to a page + bounding box (PDF/image) or a
  text/cell range (DOCX/XLSX rendered to PDF for redaction at v0.1).
- **FR2** — Applying redactions shall produce a new **redacted rendition** — a
  separate stored object — in which the content under each region is
  **removed/flattened**, not merely overlaid. The rendition is a first-class
  artifact distinct from the original `document_version`.
- **FR3** — Redaction regions (the editable definition) shall be stored
  separately from the flattened rendition so an admin can revise and
  re-publish. Revising produces a new rendition; prior renditions are
  superseded.
- **FR4** — The original document bytes shall remain available **only** to
  internal roles with download rights; they shall never be served to a viewer
  whose access is scoped to the redacted rendition.

### AI-assisted suggestion

- **FR5** — On request (and optionally on upload to a flagged folder), the
  system shall produce **suggested** redaction regions by extracting text (via
  the shared `ai-doc-sensecheck` extractor) and asking Claude to identify
  likely-sensitive spans (PII, account/card numbers, names, addresses),
  returning page/box or text-range anchors.
- **FR6** — AI suggestions shall **never** be auto-applied. They appear as
  proposed regions an owner/admin must confirm, edit, or dismiss. The UI
  marks them as AI-derived (`signal` amber per the design system).
- **FR7** — The suggestion step shall fail safe: if extraction or the model
  call fails, the document is simply unredacted-with-no-suggestions, never
  silently "redacted" or blocked.

### Download integration

- **FR8** — When `access-control` resolves a viewer's download for a document
  that has a published redacted rendition and the viewer's grant is
  redaction-scoped, the pre-signed URL shall point at the **rendition**, never
  the original.
- **FR9** — A document with unconfirmed/zero redactions has no rendition;
  sharing it externally with a redaction-scoped grant shall be blocked until a
  rendition exists (no accidental full-document leak).

### Audit

- **FR10** — Emit audit events for: redaction regions created/edited, AI
  suggestions generated, rendition published, rendition superseded, redacted
  rendition downloaded by an external viewer. AI-driven entries carry the
  `CLASSIFY`/`FLAG`-style verb so they are scannable in the audit log.

## Non-functional requirements

- **NFR1** — **No original-content recovery.** The flattened rendition shall
  contain no recoverable trace of redacted content — no hidden text layer, no
  original image data under the box, no metadata leak. This is the load-bearing
  invariant and shall be verified by an extraction test (AC-US2).
- **NFR2** — Rendition generation for a ≤100MB document shall complete in
  ≤60s p95 (async; the admin is notified when ready).
- **NFR3** — AI suggestion latency shall not block the manual flow; suggestions
  arrive asynchronously and the admin can redact manually meanwhile.
- **NFR4** — Renditions are tenant-scoped storage objects under the same
  isolation guarantees as originals (`tenant-isolation` slice).
- **NFR5** — The AI suggestion prompt shall treat document text as untrusted
  input (prompt-injection-safe), consistent with `ai-search-qna`.

## Acceptance criteria

- **AC-US1** — An admin draws a box over a salary figure in a PDF; on publish, a
  redacted rendition is produced.
- **AC-US2** — Extracting text and images from the published rendition yields
  **no** trace of the redacted figure (no hidden text layer, no underlying
  pixels). Automated test asserts this.
- **AC-US3** — Requesting AI suggestions on a document with PII returns proposed
  regions marked AI-derived; none are applied until the admin confirms.
- **AC-US4** — An external viewer with a redaction-scoped grant downloads the
  document and receives the rendition; there is no API path that returns the
  original bytes to that viewer.
- **AC-US5** — Sharing a document externally (redaction-scoped) with no
  published rendition is blocked with a clear message.
- **AC-US6** — Editing redactions and re-publishing supersedes the prior
  rendition; the superseded one is no longer served.
- **AC-US7** — Every redaction and external rendition-download appears in the
  audit log with the correct actor and verb.

## Non-goals (for this slice)

- Dynamic per-viewer watermarking / fence-view / DRM → Phase 2
  (`watermark-preview-drm`).
- Redaction of audio/video → out of scope.
- Auto-applying AI redactions without human confirmation → explicitly never.
- OCR of scanned documents for redaction → Phase 2 (depends on the OCR track).
- Collaborative simultaneous redaction → Phase 2.

## Open questions

- **DOCX/XLSX redaction:** render to PDF and redact the PDF (simpler, safe) vs.
  native-format redaction (harder, preserves editability). Leaning
  **render-to-PDF** at v0.1 — the external artifact is a fixed rendition anyway.
- **Suggestion model:** Haiku 4.5 (cheap, fast) vs. Sonnet 4.6 (better recall).
  Leaning Haiku for v0.1 with a recall eval; escalate if recall is poor.
- **Rendition storage:** new `document_renditions` table + S3 prefix vs.
  reusing `document_versions` with a `kind` discriminator. Resolve in design.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
