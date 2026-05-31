# Tasks — ai-data-room / virus-scanning

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-31

Assumes `room-and-folders` + `tenant-isolation` merged. Best landed early in
slice 2's life (the clean-gate touches the upload pipeline + the AI slices'
indexing triggers). Executes in `microservices/core`, a worker substrate
(Fargate/Lambda), `packages/db`, `packages/web`, `infra`. 90% coverage gate.

---

## T-001 — Migrations + domain: scan_state + scan_results

Status: `[ ]`
**Scope:** Add `scan_state` to `document_versions` (default `scanning`);
`scan_results` table (tenant-scoped); domain types + verdict enum.
**Files (likely):** `packages/db/schema/room.ts` (extend), `packages/db/schema/scan.ts`,
migrations, `microservices/core/domain/scan/*`.
**DoD:** Migration applies; default state `scanning`; scoped.
**Tests required:** Integration (apply + scoped); schema unit tests.

---

## T-002 — Scan worker (in-VPC ClamAV)

Status: `[ ]`
**Scope:** Worker substrate running ClamAV with auto-updated signatures; stream
object, produce verdict + signature version; resolve Fargate-vs-Lambda.
**Files (likely):** `microservices/workers/src/scan/scanWorker.ts`,
`infra/scan.ts`.
**DoD:** EICAR test file → infected; a clean fixture → clean; signature version
reported.
**Tests required:** Integration — EICAR detected; clean passes.

---

## T-003 — Lifecycle transitions + clean-gate

Status: `[ ]`
**Scope:** `scanning → available | quarantined | scan_failed`; fail-closed on
engine error with backoff retry; write `scan_results`; emit
`document.scanned.clean` / audit / quarantine notification.
**Files (likely):** `application/scan/*`, EventBridge wiring.
**DoD:** Clean→available; infected→quarantined+audit+notify; error→retry, never
clean.
**Tests required:** Unit — transition matrix incl. fail-closed; events emitted.

---

## T-004 — Consumer gating + indexing trigger swap

Status: `[ ]`
**Scope:** Ensure download / `document-viewer` / `ai-search-qna` indexer /
`ai-doc-sensecheck` / `document-redaction` act only on `available` versions;
switch AI indexing triggers from `document.uploaded` to
`document.scanned.clean`.
**Files (likely):** consumer filters + trigger config in the relevant slices.
**DoD:** No consumer can act on a `scanning`/`quarantined` version; AI indexing
keys off the clean event.
**Tests required:** Unit per consumer — non-available version is invisible;
integration — unscanned file is not indexed.

---

## T-005 — Application + Web: scan status + quarantine admin

Status: `[ ]`
**Scope:** `GET /documents/:id/scan-status`, `GET /quarantine`,
`DELETE /quarantine/:versionId`; admin UI for scan status + quarantine list +
delete.
**Files (likely):** `application/scan/*`, `packages/web/src/pages/Quarantine.tsx`.
**DoD:** Status visible; quarantine list + delete work; admin-only.
**Tests required:** Unit (auth + listing); component tests (status, quarantine).

---

## T-006 — Observability + NFR hardening

Status: `[ ]`
**Scope:** Verdict/latency/backlog/retry/quarantine metrics; alarms (backlog

> 300s, any infected, scan_failed accumulation); tenant-scope + fail-closed
> hardening pass.
> **Files (likely):** `infrastructure/observability/metrics.ts`, `infra/*`.
> **DoD:** Metrics emit; alarms wired; NFR matrix complete.
> **Tests required:** Unit — metric emission; fail-closed assertion.

---

## T-007 — Playwright acceptance + slice sign-off

Status: `[ ]`
**Scope:** E2E: upload clean → becomes downloadable; upload EICAR → quarantined +
not downloadable + admin alerted. Traceability matrix; sign-off; tag.
**Files (likely):** `e2e/specs/virus-scanning/*`, `docs/slices/virus-scanning.md`.
**DoD:** E2E green; matrix complete; sign-off merged.
**Tests required:** Playwright suite; CI green.
