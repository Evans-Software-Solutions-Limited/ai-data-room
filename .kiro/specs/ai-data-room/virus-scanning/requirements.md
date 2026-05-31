# Requirements — ai-data-room / virus-scanning

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-05-31
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `room-and-folders` (upload pipeline)

## Context

`room-and-folders` NFR5 deferred virus scanning to Phase 2 ("architecture shall
not preclude future virus scanning"). For a security-positioned data room that
stores files which external parties then download, scanning uploads for malware
is a credibility and liability item — a malicious file passed from a customer's
room to a counterparty is exactly the failure the product exists to prevent.
This slice adds **scan-on-upload with quarantine**: an uploaded file is not
downloadable or AI-processable until it has passed a malware scan.

## Users & roles

- **Primary beneficiaries:** everyone who downloads from a room (internal +
  external) — they only ever receive scanned-clean files.
- **Primary actor:** the upload pipeline (automatic); admins see scan status and
  handle quarantined files.
- **Roles (from `auth-and-orgs`):** all roles benefit; only owner/admin act on
  quarantined items.

## User stories

- **US1** — _As an owner, I want every uploaded file scanned for malware before
  anyone can download it, so my room can't become a malware vector._
- **US2** — _As an external viewer, I want assurance that files I download have
  been scanned clean._
- **US3** — _As an admin, I want to see the scan status of documents and be
  alerted when something is quarantined, so I can remove or replace it._
- **US4** — _As an uploader, I want upload to succeed immediately and scanning
  to happen in the background, with a clear status if a file is flagged._

## Functional requirements

- **FR1** — Every uploaded file shall be scanned for malware before its
  document version is marked **available**. Until the scan passes, the version
  is in a `scanning` state.
- **FR2** — Scanning shall be **async** — it must not block upload completion
  (FR-aligned with `room-and-folders` resumable uploads) but must complete
  before the document is downloadable or AI-processable.
- **FR3** — A file that fails the scan shall be moved to **quarantine**: hidden
  from listings, never downloadable, never indexed by Q&A/search, never
  sense-checked or rendered. An audit event + admin notification is raised.
- **FR4** — Downstream consumers (download, `document-viewer`, `ai-search-qna`
  indexer, `ai-doc-sensecheck`, `document-redaction`) shall only ever act on a
  version in the `available` (clean) state — a `scanning` or `quarantined`
  version is invisible to them.
- **FR5** — Scan results (engine, signature version, verdict, scanned-at) shall
  be recorded per document version.
- **FR6** — Admins shall be able to see scan status per document and view a list
  of quarantined items, with the option to delete them.
- **FR7** — A scan that errors (engine failure, not a positive detection) shall
  **fail closed** — the version stays `scanning`/unavailable and is retried;
  it shall never be auto-marked clean on error.

## Non-functional requirements

- **NFR1** — A ≤100MB file shall be scanned within ≤2min p95 of upload
  completion.
- **NFR2** — Scanning shall run in-VPC (no third-party egress of document
  bytes), consistent with the AI-vendor boundary stance.
- **NFR3** — Quarantined bytes shall remain tenant-scoped and encrypted; access
  to a quarantined object shall be denied to all normal paths.
- **NFR4** — Signature definitions shall be auto-updated; the scan engine shall
  report its signature version (FR5) for auditability.
- **NFR5** — Scan backlog age shall be alarmed (>300s) so a stuck scanner is
  caught before it blocks the room.

## Acceptance criteria

- **AC-US1** — An uploaded clean file transitions `scanning → available` and
  only then becomes downloadable / indexable.
- **AC-US2** — A known-malicious test file (EICAR) is quarantined: hidden from
  listings, undownloadable, unindexed; an audit event + admin notification fire.
- **AC-US3** — While a file is `scanning`, no download/view/index/sense-check/
  redaction path can act on it.
- **AC-US4** — A scanner error leaves the file unavailable and retried — never
  auto-cleaned.
- **AC-US5** — An admin sees scan status per document and a quarantine list, and
  can delete a quarantined file.

## Non-goals (for this slice)

- Content / DLP inspection (detecting sensitive data) → that's `document-
redaction` + sense-check, not malware scanning.
- Scanning of AI-generated renditions/renders (they derive from already-scanned
  originals) → not required.
- Email-attachment scanning → out of scope.
- CDR (content disarm & reconstruction) → Phase 2 if ever.

## Open questions

- Engine: in-VPC ClamAV (open-source, EICAR-testable, self-hosted updates) vs. a
  managed scanning service. Leaning ClamAV in a worker to keep bytes in-boundary
  (NFR2). Resolve in design.
- Should scanning gate the **upload-complete** response (synchronous for small
  files) or always be async with a `scanning` state? Leaning always-async with
  state for a uniform path.
- Retry/backoff policy + max attempts before a scan is declared `failed` (vs.
  `quarantined` for a positive detection). Resolve in design.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
