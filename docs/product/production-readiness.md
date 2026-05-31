# Production-readiness register — ai-data-room

**Status:** draft (2026-05-31). Owner: Bradley. Companion to
[positioning](./positioning.md) and the
[spec index](../../.kiro/specs/ai-data-room/README.md).

> Purpose: promote the production-readiness risks that are currently scattered
> across `HANDOFF.md` follow-ups into **tracked release blockers**, and record
> the genuine spec gaps surfaced by the 2026 competitive scan. This is a
> planning artifact, not a spec — each blocker should graduate into a kiro task
> in the owning slice.

## Where the build actually is (2026-05-31)

- **Slice 1 (`auth-and-orgs`): DONE + tagged.** All 22 tasks merged; PR #28
  squashed to `main` at `2be475c` (2026-05-31); tag `v0.1.0-auth-and-orgs`
  created. Strong engineering — clean layered architecture, 90% coverage gates
  per workspace, full CI, no Drizzle leakage into handlers, zero `TODO`/`FIXME`.
  Two honest carve-outs remain (RB-2, RB-3 below).
- **Slices 2–17:** specs complete (requirements + design + tasks drafted), **no
  code**. The product — org provisioning, rooms, folders, upload, AI
  sense-check, cited Q&A, viewer, redaction, search, billing, admin, onboarding
  — is unbuilt.
- **Net:** we have a production-grade *auth foundation*, not a product. The
  "AI data room" magic is entirely ahead of us. First build target:
  `org-provisioning` (slice 17, T-001).

## Release blockers (graduate to kiro tasks)

| # | Blocker | Owning slice | Severity | Note |
| - | --- | --- | --- | --- |
| RB-1 | **Prove multi-tenant isolation** — row-level tenant guard + property test before any document-storage task merges. | tenant-isolation (slice 10) | **Critical** | See [ADR-011](../../adr/011-multi-tenant-isolation.md). Single largest breach risk. Now its own slice; runs after org-provisioning (17), before rooms (2). |
| RB-2 | **Deploy the e2e stage** — provision the e2e environment + WorkOS test tenant + seeded user so slice-1 Playwright specs actually exercise a deployed backend. | auth-and-orgs | High | T-021's full DoD ("11 specs green") is unmet; 8 of 11 deferred. Runbook: `docs/runbooks/e2e-stage.md`. |
| RB-3 | **Resolve or formally waive MFA audit events** — `handleMfaEnrolled` / `handleRecoveryCodeUsed` are implemented + tested but unreachable (WorkOS SDK v8.13 doesn't emit those event types). FR17/FR24 are paper-only. | auth-and-orgs | Medium | Either wire when the SDK exposes the events, or waive with an ADR. |
| RB-4 | **Delete `hello-world` template scaffolding** from `microservices/core` and `microservices/workers` before it gets cargo-culted into a real slice. | chore | Low | Pure cleanup. |
| RB-5 | **Per-org feature-flag mechanism** — `ai-search-qna` assumes a `qna_enabled` flag with no owner. | auth-and-orgs | Low | Fold a small shared flag util into `auth-and-orgs`; no separate slice. |
| RB-6 | **Org provisioning** — slice 1 left `/me.orgId = null`; nothing self-serve creates an org before slice 9. | org-provisioning (slice 17) | **Critical (sequencing)** | Pulled forward out of slice 9. Slices 2 + 10 need a real `org_id`. First build target. |

## Inherited slice-1 follow-ups that intersect new work

From `.kiro/specs/ai-data-room/auth-and-orgs/follow-ups/` (11 total; these four
touch the new slices):

- **#11 Caddy + `.test` dev domains** — blocked on slice 2's cross-subdomain
  cookie need; revisit when `room-and-folders`/`document-viewer` need same-origin
  dev cookies (sticky #47 — current strategy is a Vite proxy).
- **#8 production `FRONTEND_URL`** — hardcoded placeholder for non-`$dev` stages;
  swap to the real domain when the web app gets one (positioning/readiness
  adjacent).
- **#10 external-grant `LIMIT`** — `externalGrantRepo.listByUser` returns every
  row; add `where status='active'` + LIMIT in `access-control` (slice 3).
- **#5 MFA handler wiring** — see RB-3; blocked on the WorkOS event-name
  investigation.

## Spec gaps surfaced by the competitive scan

| Gap | Status in specs | Recommendation |
| --- | --- | --- |
| **Document redaction** (manual + AI-assisted) | **Now spec-complete** — slice 11 (`document-redaction`). | Reuses the sense-check extractor; AI suggestions in `signal` amber. Table-stakes vs Ideals/Datasite/Ansarada/Drooms/Imprima. |
| **In-app document viewer** | **Now spec-complete** — slice 12 (`document-viewer`). | Resolves the contradiction: redaction + Q&A auditability needed a viewer the brief had deferred. |
| **Notifications / product-email** | **Now spec-complete** — slice 13 (`notifications`). | Was referenced but unscoped in onboarding + admin. Drives stickiness. |
| **OCR + keyword search** | **Now spec-complete** — slice 14 (`search-ocr`). | OCR removes scanned-doc blind spots; keyword search beside semantic Q&A. |
| **Data export / offboarding** | **Now spec-complete** — slice 15 (`data-export`). | Per-org export + GDPR portability + verifiable purge. |
| **Virus scanning on upload** | **Now spec-complete** — slice 16 (`virus-scanning`). | Scan-on-upload + quarantine; clean-gates every consumer. |
| **Per-org feature-flag mechanism** | Orphaned — `ai-search-qna` assumes `qna_enabled` but nothing owns flags. | Fold a small shared flag util into `auth-and-orgs` (no own slice). Tracked here as RB-5. |
| **Watermarking / fence-view / DRM** | Consciously Phase 2 (`room-and-folders` NFR6, `access-control` exclusions). | Hold at Phase 2 **if** we stay in the SME lane (see positioning §open decision). Needs Bradley's explicit call. |
| **Competitive positioning / north star** | Was nowhere in the specs. | Now captured in [positioning.md](./positioning.md). Slices should point at it. |
| **Security certification path** (ISO 27001 → SOC 2) | Phase 2 backlog (`soc2-iso27001`). | Keep Phase 2, but make the roadmap visible to buyers to de-risk procurement. |

## Recommended sequence to a demoable product

> The authoritative, task-level ordered backlog lives in
> [`implementation-plan.md`](./implementation-plan.md). The summary below is the
> rationale.

To showcase the product's magic fastest — the "upload → AI checks it → ask a
question → get a cited answer" loop — sequence the slices for *demo value*, not
just dependency order:

0. **Slice 17 — org-provisioning** (creates the `org_id` everything attaches to).
1. **Slice 10 — tenant-isolation** (carries RB-1; gates document storage).
2. **Slice 2 — room-and-folders** (+ slice 16 virus-scanning + slice 12 viewer alongside).
3. **Slice 6 — ai-search-qna** (the wedge; the hero demo moment).
4. **Slice 5 — ai-doc-sensecheck** (the proactive-AI differentiator).
5. **Slice 4 — doc-checklist** (completes the self-serve onboarding story).
6. **Slices 8 / 7 / 9 — billing / admin / onboarding** (trail; GA, not the demo).

Dependency constraints from the spec README still hold (4/5/6 need 2; 8 needs 1;
2 + 10 need 17). This ordering front-loads the slices that make the demo sing.
