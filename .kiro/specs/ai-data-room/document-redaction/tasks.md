# Tasks — ai-data-room / document-redaction

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-31

Assumes `room-and-folders`, `access-control`, and `tenant-isolation` are merged.
Executes in `microservices/core` (`domain/redaction`, `application/redaction`,
`infrastructure/{db,s3,redaction}`), a new `microservices/workers` worker, and
`packages/web`. The AI-assist tasks soft-depend on the `ai-doc-sensecheck`
extractor.

## Conventions

Same as `auth-and-orgs/tasks.md` (Bun + Turborepo, Vitest unit + integration,
Playwright, layered architecture, prompts versioned in code, 90% coverage gate).

---

## T-001 — Migrations + domain: redactions + renditions

Status: `[ ]`
**Scope:** Drizzle migrations for `redactions` and `document_renditions`
(tenant-scoped); domain types + zod schemas for regions (box + text-range),
provenance + status enums. Confirm storage-model open question.
**Files (likely):** `packages/db/schema/redaction.ts`,
`packages/db/migrations/*.sql`, `microservices/core/domain/redaction/*`.
**DoD:** Migrations apply cleanly; tables route through the `tenant-isolation`
factory; schemas have barrel exports.
**Tests required:** Integration (apply + insert + scoped query); unit on schemas.

---

## T-002 — Infrastructure: repos + S3 rendition store

Status: `[ ]`
**Scope:** `RedactionRepo`, `RenditionRepo` via `scopedRepo`; S3 wrapper for the
private rendition prefix (SSE-KMS, no public access), pre-signed GET for
renditions.
**Files (likely):** `infrastructure/db/redactionRepo.ts`,
`infrastructure/db/renditionRepo.ts`, `infrastructure/s3/renditions.ts`.
**DoD:** Repos org-scoped; rendition objects private; pre-signed URL scoped +
TTL-bounded.
**Tests required:** Unit (repos scoped); integration (S3 put/get in-prefix only).

---

## T-003 — Application: manual region CRUD

Status: `[ ]`
**Scope:** Create/replace/delete draft regions; `GET` current set + rendition
status. Owner/admin authorisation via `authorizeOrgAccess`.
**Files (likely):** `application/redaction/*`.
**DoD:** Regions persisted as draft; external roles 403; audit events emitted.
**Tests required:** Unit — CRUD happy + auth-failure; audit emitted.

---

## T-004 — Flatten pipeline + verify (the security core)

Status: `[ ]`
**Scope:** The remove-then-rasterise-then-verify pipeline producing a redacted
PDF rendition; DOCX/XLSX → PDF pre-render. Mandatory verify step (extractor
finds no redacted span / no image under region) gating publication.
**Files (likely):** `infrastructure/redaction/flatten.ts`,
shared extractor import from `ai-doc-sensecheck`.
**DoD:** Published rendition passes verify; a region's content is unrecoverable.
**Tests required:** **AC-US2** — extract from rendition asserts zero trace
(text + image); a forced overlay-only output fails verify.

---

## T-005 — Application + worker: publish rendition (async)

Status: `[ ]`
**Scope:** `POST /redactions/publish` enqueues; worker runs the pipeline, writes
`document_renditions` (current), supersedes prior, emits events + metrics.
**Files (likely):** `application/redaction/publish.ts`,
`microservices/workers/src/redaction/renderWorker.ts`, `infra/*` (SQS).
**DoD:** Publish produces a current rendition ≤60s p95; prior superseded.
**Tests required:** Unit (state transitions); integration (enqueue → render →
current rendition).

---

## T-006 — Download integration with access-control

Status: `[ ]`
**Scope:** `resolveServedObject(doc, grant)` → original (internal w/ rights) vs.
current rendition (redaction-scoped). Block external share when no current
rendition (FR9). No code path serves original to a redaction-scoped viewer.
**Files (likely):** `application/redaction/serve.ts`, integration point in
`access-control` download path.
**DoD:** Redaction-scoped viewer always gets the rendition; no-rendition share
blocked; AC-US4/AC-US5 hold.
**Tests required:** Unit — resolver matrix (role × rendition state); a negative
test proving no original-bytes path for redaction-scoped grants.

---

## T-007 — AI suggestion worker + prompt

Status: `[ ]`
**Scope:** `POST /redactions/suggest` → SQS → worker: shared extractor + Claude
Haiku 4.5 with versioned `redaction-suggest-v1` prompt (untrusted-input
framing); writes `source='ai_suggested'` draft regions. Fail-safe on error.
**Files (likely):** `domain/redaction/prompts/redaction-suggest-v1.ts`,
`microservices/workers/src/redaction/suggestWorker.ts`,
`infrastructure/anthropic/*`.
**DoD:** Suggestions appear as draft (never applied); model/extractor failure
yields zero suggestions, never a block.
**Tests required:** Unit — suggestions never auto-publish; failure path safe;
prompt-injection fixture ignored.

---

## T-008 — Web: redaction editor + AI suggestions

Status: `[ ]`
**Scope:** Admin redaction UI — draw/edit boxes on preview, see AI-suggested
regions in `signal` amber, confirm/dismiss, publish. Reflects the design
brief's AI-surface treatment.
**Files (likely):** `packages/web/src/pages/Redaction*.tsx`, components.
**DoD:** Draw → publish flow works; AI suggestions visually distinct + confirm-
gated.
**Tests required:** Component tests (render, confirm/dismiss, publish states).

---

## T-009 — Eval harness: suggestion recall

Status: `[ ]`
**Scope:** `bun run eval:redaction` over a golden set with known sensitive
spans; reports recall + false-positive rate. CI runs on prompt/pipeline change.
**Files (likely):** `microservices/core/eval/redaction/*`.
**DoD:** Eval runs; snapshot committed; recall threshold documented.
**Tests required:** The eval itself + a smoke test it runs.

---

## T-010 — Observability + NFR hardening

Status: `[ ]`
**Scope:** Metrics (`renditions_published`, `render_latency_ms`,
`verify_failures`, `ai_suggestions{accepted,dismissed}`), alarm on
`verify_failures > 0`; tenant-scope + prompt-injection hardening pass.
**Files (likely):** `infrastructure/observability/metrics.ts`, `infra/*`.
**DoD:** Metrics emit; alarm wired; hardening matrix complete.
**Tests required:** Unit — metric emission; security assertions.

---

## T-011 — Playwright acceptance + slice sign-off

Status: `[ ]`
**Scope:** E2E: admin redacts → publishes → external viewer downloads rendition
(not original). Traceability matrix; sign-off doc; tag.
**Files (likely):** `e2e/specs/document-redaction/*`,
`docs/slices/document-redaction.md`.
**DoD:** E2E green on the deployed stage; matrix complete; sign-off merged.
**Tests required:** Playwright suite; CI green across the slice.
