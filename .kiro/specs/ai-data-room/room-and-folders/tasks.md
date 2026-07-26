# Tasks — ai-data-room / room-and-folders

**Status:** ready — design signed off + tasks phase unblocked (2026-07-16)
**Design:** [./design.md](./design.md)
**Last updated:** 2026-07-16

Assumes the `auth-and-orgs` slice is already merged (T-022 tagged).
Executes inside the same monorepo (`ai-data-room`), in the same
`microservices/core` package — new files added under
`domain/room`, `application/room`, `infrastructure/{db,s3}`,
`handlers/rooms`.

## Conventions

Same as `auth-and-orgs/tasks.md` (Bun + Turborepo, Vitest, Playwright,
layered architecture, drizzle migrations).

---

## T-001 — Storage infra: S3 bucket + KMS key + IAM

Status: `[ ]`
**Scope:** New SST infra file `infra/storage.ts`. Provisions the docs
bucket (per stage), dedicated KMS CMK, scoped IAM policies for
`core`'s execution role. Bucket has public access blocked, SSE-KMS,
versioning on, lifecycle rule for `state=hard-deleted` tag → delete
after 7 days.
**Files (likely):** `infra/storage.ts`, `sst.config.ts`.
**Definition of done:**

- Stage deploy shows the bucket + KMS key wired.
- IAM role for `core` can PutObject / GetObject under
  `orgs/*/documents/*` but not outside.
- Bucket is closed to unauthenticated requests.
  **Tests required:** Integration test that the handler role can
  upload/download in its prefix and is denied outside it.

---

## T-002 — Domain: types + zod schemas

Status: `[x]` (PR #52)
**Scope:** `Opportunity`, `Document`, `DocumentVersion`, `FolderPath`
discriminated union, `CanonicalFolder` enum const, `MimeTypeEnum`,
`DocumentState`, `OpportunityStatus`. DTOs for listings + single-doc
fetch.
**Files (likely):** `microservices/core/domain/room/*.ts`,
`packages/api-utils/schemas/room.ts`.
**DoD:** Barrel exports; unit tests for schemas.
**Tests required:** Vitest — happy + failure cases per schema.

---

## T-003 — Migrations: four tables

Status: `[x]` (PR #53)
**Scope:** Drizzle migrations for `opportunities`, `documents`,
`document_versions`, `document_deletions`. Include CHECK constraints
(XOR between canonical + opportunity), partial indexes, unique
indexes from design.md.
**Files (likely):** `packages/db/schema/room.ts`,
`packages/db/migrations/*.sql`.
**DoD:** Applies cleanly; drizzle-kit introspection matches schema
file; reverse tested manually.
**Tests required:** Integration: apply migrations in a transactional
test DB, insert each table's happy-path row, query, roll back.

---

## T-004 — Infrastructure: repositories

Status: `[x]` (PR #54)
**Scope:** `OpportunityRepo`, `DocumentRepo`, `DocumentVersionRepo`,
`DocumentDeletionRepo`. Query methods: list-by-folder, list-by-
opportunity, get-with-current-version, create-version, soft-delete,
restore, hard-delete (support-only), archive-opportunity.
**Files (likely):**
`microservices/core/infrastructure/db/room/*.ts`.
**DoD:** Each method covered by one integration test.
**Tests required:** Vitest integration per repo method.

---

## T-005 — Infrastructure: S3 client wrapper

Status: `[x]` (PR #55)
**Scope:** Thin wrapper over `@aws-sdk/client-s3` exposing only what
we use: `createMultipartUpload`, `presignPartUrls(uploadId, parts)`,
`completeMultipartUpload`, `abortMultipartUpload`,
`presignDownloadUrl(key, versionId, ttl)`, `headObject`,
`deleteObject`. Wraps `getObjectMetadata` to compute sha256 via
object metadata where possible, else stream to compute on completion.
**Files (likely):**
`microservices/core/infrastructure/s3/client.ts`.
**DoD:** Module side-effect free; all methods covered by unit tests
using `aws-sdk-client-mock`.
**Tests required:** Vitest — mocked SDK + signature verification of
pre-signed URL format.

---

## T-006 — Application: opportunity CRUD

Status: `[x]` (PR #57)
**Scope:** `createOpportunity`, `renameOpportunity`,
`archiveOpportunity`, `listOpportunities`. Enforce slug regex,
uniqueness per org, archive → revoke-external-grants via
`access-control` (cross-slice call; import from `access-control`
application layer). Audit events per FR19.
**Files (likely):**
`microservices/core/application/room/opportunities.ts`.
**DoD:** FR4–FR7 covered in application tests.
**Tests required:** Unit + integration for rename (no data loss) and
archive (grants revoked + retention timer started).

---

## T-007 — Application: upload initiate + complete

Status: `[x]` (PR #58)
**Scope:** `initiateUpload` — validates target, mime, size; creates
`documents.state='draft'` + `document_versions.version_number` row;
starts S3 multipart; returns `upload_id` + pre-signed part URLs.
`completeUpload` — completes S3 multipart, computes sha256, writes
final row, flips `documents.state='active'` + sets
`current_version_id`, emits `file_uploaded` audit event. Filename
collision → new version (FR13).
**Files (likely):**
`microservices/core/application/room/upload.ts`.
**DoD:** FR8–FR13 covered.
**Tests required:** Integration tests with a local minio or
aws-sdk-client-mock; unit tests for validation branches.

---

## T-008 — Application: document listing + download

Status: `[x]` (PR #60)
**Scope:** `listFolderContents` (canonical or opportunity),
`getDocument` (with pre-signed GET URL), `listVersions`. Returns
only `state='active'` documents by default. Pre-signed URL TTL
5 min (FR16); generator function exported for reuse by
`access-control`'s revalidator.
**Files (likely):**
`microservices/core/application/room/listing.ts`,
`microservices/core/application/room/download.ts`.
**DoD:** FR14–FR16 covered.
**Tests required:** Unit + integration; listing p95 measurement in
integration test with 500-row fixture.

---

## T-009 — Application: soft-delete + restore + hard-delete

Status: `[x]` (PR #61)
**Scope:** `softDeleteDocument`, `restoreDocument`,
`hardDeleteDocument` (support-only path — not exposed via handler at
v0.1). Soft-delete sets `state='soft_deleted'` + `soft_deleted_at`;
restore within 30d flips back to active. Hard-delete tags S3 object
with `state=hard-deleted` and writes `document_deletions` row.
**Files (likely):**
`microservices/core/application/room/deletion.ts`.
**DoD:** FR17–FR18 covered.
**Tests required:** Integration tests for the three transitions +
audit events.

---

## T-010 — Scheduled job: retention sweep

Status: `[x]` (PR #62 — application sweep + frozen-clock integration test; EventBridge cron + lambda handler deferred to the T-001/deploy batch)
**Scope:** EventBridge cron (every 6 hours) invokes a lambda that:
(a) hard-deletes documents whose `soft_deleted_at > 30d ago`;
(b) hard-deletes opportunities whose `archived_at > 90d ago` and
their documents; (c) cleans up drafts older than 24h. Idempotent
(re-running produces no duplicate actions or audit events).
**Files (likely):** `microservices/core/application/room/retention.ts`,
`infra/scheduled.ts`, `microservices/core/handlers/schedule/retention.ts`.
**DoD:** Running against seeded test DB produces the expected
deletions; re-running is a no-op.
**Tests required:** Integration test with frozen clock + seeded
fixtures.

---

## T-011 — Handlers: rooms + opportunities + documents

Status: `[x]` (PR #63 — 14 routes + no-op access-control seam; dev-stack integration deferred to AWS batch)
**Scope:** Wire the application layer into HTTP handlers per
§Interfaces. All routes behind session middleware + access-control
middleware (the latter is a no-op until `access-control` slice
lands; register the extension point now).
**Files (likely):** `microservices/core/handlers/rooms/*.ts`,
`microservices/core/handlers/opportunities/*.ts`,
`microservices/core/handlers/documents/*.ts`,
`microservices/core/handlers/uploads/*.ts`, `infra/api.ts`.
**DoD:** Every route in design.md responds per schema.
**Tests required:** Integration tests per route against the dev
stack.

---

## T-012 — Handler: abort stale upload (janitor)

Status: `[x]` (folded into T-010's retention sweep, PR #62 — the draft-purge leg hard-deletes `state='draft'` docs >24h via `DocumentRepo.purgeDraft`; S3 multipart auto-abort at 7d covers the object side since the upload_id isn't persisted. The user-facing `DELETE /uploads/:uploadId` abort route landed in T-011.)
**Scope:** Hook into the retention sweep (T-010) to call S3
`abortMultipartUpload` for any upload_id whose `documents.state='draft'`
and `created_at > 24h ago`, then hard-delete the DB row.
**Files (likely):**
`microservices/core/application/room/cleanup.ts` (alongside retention).
**DoD:** No dangling S3 multipart uploads older than 24h in
production, measured via a weekly audit query.
**Tests required:** Integration.

---

## T-013 — Web: folder navigation + document list

Status: `[x]` (PR #64 — web `/room` folder nav + document list; Playwright AC deferred to T-019/stack)
**Scope:** Vite SPA route `/room` (React Router entry): renders
the seven canonical folders + `Opportunities/` list. Clicking a
folder → list documents. Uses `/me` + `/rooms` responses.
Deliberately plain UI; polish in `admin-dashboard` /
`onboarding-flow`.
**Files (likely):** `packages/web/src/pages/Room.tsx` plus the
route-table entry in `packages/web/src/App.tsx`.
**DoD:** AC-US1 + AC-US8 pass in Playwright.
**Tests required:** Playwright.

---

## T-014 — Web: upload UI (dropzone + progress)

Status: `[x]` (PR #65 — dropzone + per-file progress modal on `/room`, presigned-part transport; PR #66 fixed the eden `mimeType` literal-union inference; Playwright AC deferred to T-019/stack)
**Scope:** `UploadDropzone` component using `@aws-sdk/lib-storage` on
the client against our `/uploads/*` endpoints. Shows progress per
file; handles resume on tab reload via an in-memory upload registry.
**Files (likely):** `packages/web/app/room/upload/*`.
**DoD:** AC-US4, AC-US5 pass in Playwright.
**Tests required:** Playwright + jsdom unit tests for the registry.

---

## T-015 — Web: opportunity create / rename / archive

Status: `[x]` (PR #67 — create/rename/archive on `/room`, owner/editor-gated; Playwright AC deferred to T-019/stack)
**Scope:** Pages under `/room/opportunities/*`. Admin-gated via role
check (enforcement server-side; UI disables accordingly).
**Files (likely):** `packages/web/app/room/opportunities/**/*.tsx`.
**DoD:** AC-US2, AC-US3 pass.
**Tests required:** Playwright.

---

## T-016 — Web: soft-delete + restore + version history

Status: `[ ]`
**Scope:** Document-detail page showing version history; soft-delete
button; restore button within retention window.
**Files (likely):** `packages/web/app/room/documents/[id]/page.tsx`.
**DoD:** AC-US6 passes.
**Tests required:** Playwright.

---

## T-017 — Observability: metrics, traces, alerts

Status: `[ ]`
**Scope:** EMF metrics per design.md §Observability, X-Ray enabled,
CloudWatch alarms wired in `infra/observability.ts`.
**Files (likely):** `infra/observability.ts`,
`microservices/core/infrastructure/metrics/room.ts`.
**DoD:** Metric names emit at least once during e2e; alarms fire
correctly on synthetic incidents.
**Tests required:** Smoke integration.

---

## T-018 — NFR hardening pass

Status: `[ ]`
**Scope:** Verify NFR1 (SSE-KMS), NFR2 (private bucket), NFR3 (rate
limit 50/org/min on upload initiate), NFR4 (listing p95 ≤500ms
with 500 docs), NFR7 (per-org export script exists), NFR8
(append-only version history). Document the matrix.
**Files (likely):** `docs/security.md` (append),
`tests/security/room-nfr-matrix.spec.ts`.
**DoD:** Matrix test green in CI.
**Tests required:** That file.

---

## T-019 — Playwright acceptance suite

Status: `[ ]`
**Scope:** One spec per AC-US1–AC-US8 against the e2e stage.
**Files (likely):** `tests/e2e/room-and-folders/*.spec.ts`.
**DoD:** All 8 specs green.

---

## T-020 — Slice sign-off + traceability matrix

Status: `[ ]`
**Scope:** Map each FR, NFR, AC to a specific test. Run
`engineering:deploy-checklist`. Tag `v0.2.0-room-and-folders`.
**Files (likely):** `docs/slices/room-and-folders.md`.
**DoD:** Traceability matrix committed.

---

## Dependencies

```
T-001 ──► T-005 ──► T-007 ──► T-008 ──► T-011 ──► T-013/14/15/16
         ▲          ▲                   ▲
T-002 ──►T-003 ──► T-004 ───────────────┤
                          ─► T-006 ─────┤
                          ─► T-009 ─────┤
                          ─► T-010 ─────┘

T-012 after T-010
T-017, T-018 in parallel after T-011
T-019 after T-013–T-016
T-020 last
```

## Acceptance for the slice

1. All AC-US\* in `requirements.md` pass in Playwright.
2. T-020 traceability matrix merged.
3. `v0.2.0-room-and-folders` tagged.
