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

- **Slice 1 (`auth-and-orgs`):** 21/22 tasks merged; T-022 (sign-off + tag) in
  PR #28. The engineering is strong — clean layered architecture, 90% coverage
  gates per workspace, full CI, no Drizzle leakage into handlers, zero
  `TODO`/`FIXME` in source.
- **Slices 2–9:** specs complete (requirements + design + tasks drafted), **no
  code**. The product — rooms, folders, upload, AI sense-check, cited Q&A,
  billing, admin, onboarding — is unbuilt.
- **Net:** we have a production-grade *auth foundation*, not a product. The
  "AI data room" magic is entirely ahead of us.

## Release blockers (graduate to kiro tasks)

| # | Blocker | Owning slice | Severity | Note |
| - | --- | --- | --- | --- |
| RB-1 | **Prove multi-tenant isolation** — row-level tenant guard + property test before any document-storage task merges. | room-and-folders | **Critical** | See [ADR-011](../../adr/011-multi-tenant-isolation.md). Single largest breach risk. |
| RB-2 | **Deploy the e2e stage** — provision the e2e environment + WorkOS test tenant + seeded user so slice-1 Playwright specs actually exercise a deployed backend. | auth-and-orgs | High | T-021's full DoD ("11 specs green") is unmet; 8 of 11 deferred. Runbook: `docs/runbooks/e2e-stage.md`. |
| RB-3 | **Resolve or formally waive MFA audit events** — `handleMfaEnrolled` / `handleRecoveryCodeUsed` are implemented + tested but unreachable (WorkOS SDK v8.13 doesn't emit those event types). FR17/FR24 are paper-only. | auth-and-orgs | Medium | Either wire when the SDK exposes the events, or waive with an ADR. |
| RB-4 | **Delete `hello-world` template scaffolding** from `microservices/core` and `microservices/workers` before it gets cargo-culted into a real slice. | chore | Low | Pure cleanup. |

## Spec gaps surfaced by the competitive scan

| Gap | Status in specs | Recommendation |
| --- | --- | --- |
| **Document redaction** (manual + AI-assisted) | Absent — only *log* redaction exists (`room-and-folders/design.md`, `ai-search-qna/design.md`). | Add as a slice-2 / slice-5 requirement. Reuse the sense-check extraction pipeline; flag AI suggestions in `signal` amber. Table-stakes vs Ideals/Datasite/Ansarada/Drooms/Imprima. |
| **Watermarking / fence-view / DRM** | Consciously Phase 2 (`room-and-folders` NFR6, `access-control` exclusions). | Hold at Phase 2 **if** we stay in the SME lane (see positioning §open decision). Needs Bradley's explicit call. |
| **Competitive positioning / north star** | Was nowhere in the specs. | Now captured in [positioning.md](./positioning.md). Slices should point at it. |
| **Security certification path** (ISO 27001 → SOC 2) | Phase 2 backlog (`soc2-iso27001`). | Keep Phase 2, but make the roadmap visible to buyers to de-risk procurement. |

## Recommended sequence to a demoable product

To showcase the product's magic fastest — the "upload → AI checks it → ask a
question → get a cited answer" loop — sequence the slices for *demo value*, not
just dependency order:

1. **Slice 2 — room-and-folders** (unblocks everything; carries RB-1).
2. **Slice 6 — ai-search-qna** (the wedge; the hero demo moment).
3. **Slice 5 — ai-doc-sensecheck** (the proactive-AI differentiator).
4. **Slice 4 — doc-checklist** (completes the self-serve onboarding story).
5. **Slices 8 / 7 / 9 — billing / admin / onboarding** (trail; needed for GA, not for the demo).

Dependency constraints from the spec README still hold (4/5/6 need 2; 8 needs 1).
This ordering just front-loads the slices that make the demo sing.
