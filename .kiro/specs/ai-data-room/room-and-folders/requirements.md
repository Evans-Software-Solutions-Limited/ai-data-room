# Requirements — ai-data-room / room-and-folders

**Status:** signed off (Bradley, 2026-07-16 — amended: `07_Information_Security` added as a seventh canonical folder per the fintech vendor-pack norms research, [docs/product/fintech-vendor-pack-norms.md](../../../../docs/product/fintech-vendor-pack-norms.md))
**Owner:** Bradley
**Last updated:** 2026-07-16
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `auth-and-orgs`

## Context

Delivers the room itself — a fixed seven-folder canonical structure per org,
plus an `Opportunities/` container that can hold one or more subrooms
(e.g. `Vendor_A`, `Vendor_B`). Enables uploading, listing, downloading,
and deleting documents. This slice owns the **structure** and the
**primitive CRUD on documents**. It does **not** own who can see what —
that's `access-control` — and it does not own the checklist metadata
that sits on top of each folder — that's `doc-checklist`.

## Users & roles

- **Primary user:** owner/editor uploading or organising documents.
- **Secondary users:** internal contributors uploading into their slots;
  external viewers listing/downloading within their Opportunity scope.
- **Roles (from `auth-and-orgs`):** `owner`, `editor`, `viewer`,
  `external`. External users only see Opportunity subrooms they have a
  grant for; the seven canonical folders are never shown to external users.

## User stories

- **US1** — _As an owner whose org has just been created, I want the
  canonical seven-folder room pre-provisioned so I don't have to decide
  what the folders should be._
- **US2** — _As an owner/editor, I want to create a new Opportunity
  subroom (e.g. `Vendor_C`) when we engage a new counterparty so I can
  invite them with scoped access._
- **US3** — _As an owner/editor, I want to rename or delete an
  Opportunity subroom when the engagement ends._
- **US4** — _As an internal user, I want to upload a document into a
  specific folder (e.g. `02_Financials`) so it's available to the rest
  of my team._
- **US5** — _As an internal user, I want to replace a document with a
  newer version without losing history of what was there before._
- **US6** — _As an internal user, I want to delete a document I
  uploaded by mistake._
- **US7** — _As an external viewer, I want to list and download the
  documents in the Opportunity subroom I was invited to, but see
  nothing else._
- **US8** — _As any user, I want folder navigation that matches the
  canonical structure so nothing is ambiguous about where a doc lives._

## Functional requirements

### Room provisioning

- **FR1** — On org creation (handled in `org-provisioning`, slice 17 — which
  emits `org.created`; slice 1 ships the org _model_ but defers self-serve
  provisioning), the system shall provision a room with the canonical
  structure. The provisioning subscriber MUST be idempotent on `org_id` (a
  redelivered `org.created` must not duplicate folders):
  - `01_Company_Overview`
  - `02_Financials`
  - `03_Commercial`
  - `04_Product`
  - `05_Legal`
  - `06_Operations`
  - `07_Information_Security`
  - `Opportunities/` (container, starts empty)
- **FR2** — The seven canonical top-level folders shall not be renameable,
  reorderable, or deletable by any user role at v0.1. The
  Bradley-prescribed structure is the product.
- **FR3** — Additional folders shall not be creatable at the top level
  by any user role. No nesting of custom folders inside the seven
  canonical folders at v0.1.

### Opportunity subrooms

- **FR4** — Owners and editors shall be able to create a subroom under
  `Opportunities/` by providing a name. Names shall be unique within
  the org, 1–64 characters, and restricted to `[A-Za-z0-9_\-]+`.
- **FR5** — Owners and editors shall be able to rename an Opportunity
  subroom; the rename shall preserve all documents and access grants.
- **FR6** — Owners and editors shall be able to archive an Opportunity
  subroom. Archiving hides it from navigation and revokes all related
  external access grants; the documents are retained for 90 days before
  hard delete (retention window is product-global at v0.1).
- **FR7** — Opportunity subrooms shall not contain subfolders at v0.1;
  they are flat file containers.

### Document upload

- **FR8** — Internal users (owner/editor/viewer) shall be able to
  upload files into any of the seven canonical folders or any
  Opportunity subroom. External users shall not upload at v0.1
  (separate Phase-2 "external-upload" work exists in the backlog).
- **FR9** — Supported file types at v0.1: **PDF, DOCX, XLSX, PPTX,
  PNG, JPG, CSV, TXT**. Other types are rejected with a clear error.
- **FR10** — Maximum single-file size at v0.1: **100 MB**. Larger files
  are rejected with a clear error.
- **FR11** — Uploads shall be resumable (multipart) for files >10 MB.
- **FR12** — Each upload shall store: original filename, MIME type,
  file size in bytes, sha-256 hash of contents, uploader user id,
  uploaded-at timestamp, target folder path.
- **FR13** — Filename collisions within the same folder shall be
  resolved by creating a new version (see FR15), not by overwriting
  the original.

### Document listing & download

- **FR14** — Authenticated users shall be able to list the contents of
  any folder they have visibility into (scope enforcement lives in
  `access-control`; this slice exposes the primitive and expects the
  caller to have already authorised the request).
- **FR15** — Each document shall be versioned. Listing shows the
  current version by default; older versions are retrievable via a
  version history endpoint. Hard-deleted documents (FR17) do not
  appear in version history.
- **FR16** — Downloads shall be served via **pre-signed URLs** scoped
  to the requesting session, with a TTL of **5 minutes**.

### Document deletion

- **FR17** — Internal users with appropriate role shall be able to
  soft-delete a document. Soft-deleted documents are hidden from
  listings immediately, retained for **30 days**, and hard-deleted
  thereafter. During the retention window, an owner/editor can restore.
- **FR18** — Hard deletion is not a user-facing action at v0.1 —
  support-only.

### Audit

- **FR19** — The slice shall emit audit events (via the `auth-and-orgs`
  audit writer) for: room provisioned, folder listed, file uploaded,
  file downloaded, file soft-deleted, file restored, file hard-deleted,
  opportunity subroom created, opportunity subroom renamed, opportunity
  subroom archived.

## Non-functional requirements

- **NFR1** — Document storage shall be server-side-encrypted at rest
  (KMS-managed keys, matching FDP's pattern).
- **NFR2** — The storage bucket shall be private. All external access
  to document bytes shall happen through the pre-signed URL path
  (FR16).
- **NFR3** — Upload endpoints shall rate-limit to **50 uploads per org
  per minute** at v0.1.
- **NFR4** — Listing a folder with ≤500 documents shall return in
  ≤500ms p95.
- **NFR5** — The architecture shall not preclude future virus scanning
  of uploads (ClamAV or equivalent). Virus scan is **deferred** — out
  of MVP.
- **NFR6** — The architecture shall not preclude future watermarking
  on preview (Phase 2). No watermarking at v0.1.
- **NFR7** — Storage layout shall be structured such that a single
  org's data can be exported or purged without touching other orgs'
  data.
- **NFR8** — Version history shall be append-only at v0.1.

## Acceptance criteria

- **AC-US1** — Signing up a new org results in an immediately-visible
  room with exactly the seven canonical folders and an empty
  `Opportunities/` container — no manual provisioning step.
- **AC-US2** — An owner creates an Opportunity subroom named
  `Vendor_C`; it appears in `Opportunities/` for internal users; no
  external users gain access until an invite is issued (in
  `access-control`).
- **AC-US3** — Renaming `Vendor_C` to `AcmeCorp` preserves its
  documents; archiving revokes all external grants scoped to it and
  the subroom disappears from navigation.
- **AC-US4** — An internal user uploads a PDF into `02_Financials`;
  the document appears in the folder listing for other internal users
  within 2 seconds.
- **AC-US5** — Uploading a second file with the same filename as an
  existing one creates version 2, accessible via version history;
  version 1 is still retrievable.
- **AC-US6** — Soft-deleting a document hides it from the default
  listing; an admin can restore within 30 days; after 30 days, it is
  no longer retrievable via user-facing endpoints.
- **AC-US7** — An external user invited to `Vendor_A` sees only that
  subroom's contents; they cannot list or download from any canonical
  folder or any other Opportunity.
- **AC-US8** — Navigation UI renders the seven canonical folders in the
  prescribed order (`01_` → `07_`) followed by the `Opportunities/`
  container, consistently across all roles that can see them.

## Non-goals (for this slice)

- Folder- and document-level access enforcement → `access-control`.
- Checklist metadata per folder → `doc-checklist`.
- On-upload AI validation → `ai-doc-sensecheck`.
- In-app PDF/Office viewer → Phase 2 (preview + watermarking).
- Virus scanning → Phase 2.
- Custom folder structures or arbitrary nesting → Phase 2 (not planned).
- External-user uploads → Phase 2 (backlog: `external-upload`).
- Bulk upload via desktop sync (OneDrive/GDrive) → Phase 2.
- Office-Online-style collaborative editing → Phase 2.

## Open questions

All resolved at sign-off (Bradley, 2026-07-16) — leanings confirmed:

- Video files (MP4/MOV) in v0.1? **Resolved: no** — unusual in the
  target vendor-onboarding wedge, inflates storage cost, addable later
  without schema change.
- Retention window for archived Opportunity subrooms? **Resolved:
  90 days** for regulator-friendly posture.
- `README`-style per-folder description field at v0.1? **Resolved:
  yes, display-only**, populated from `doc-checklist` defaults —
  deferred to that slice.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
