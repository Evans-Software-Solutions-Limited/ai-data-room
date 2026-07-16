# Brief: ai-data-room — AI-native secure data room

> One page. If it grows, it's a spec.

**Type:** SaaS
**Status:** brief (pending Bradley sign-off before spec phase)
**Owner:** Bradley
**Created:** 2026-04-21
**Last updated:** 2026-07-16 (folder structure +07; pricing question resolved)

## Problem

Every B2B company ends up maintaining a "pack" of standardised documents
(company overview, financials, security posture, legal, product docs) that
external parties — vendors, banks, RFP issuers, VCs, M&A buyers — repeatedly
request. Today this lives in ad-hoc OneDrive folders or expensive incumbents
(iDeals, Ansarada, Datasite). Incumbents are paid-by-necessity, not loved:
expensive, clunky UX, zero AI, and optimised for the M&A end of the spectrum
— nobody serves the everyday vendor-onboarding / RFP use case well.

## User / audience

Any B2B SME or scale-up that gets asked to fill in security-posture or
vendor-registration packs more than once a quarter. First paying customer:
Capital Pay (via Rob — CEO). No special treatment — Capital Pay pays
standard SaaS pricing like any other customer.

## Hypothesis

If we ship a permissioned document room with a **fixed, opinionated
folder structure** and an **AI layer that (a) checklists required docs per
category and sense-checks uploads, and (b) answers external questions with
citations over those docs**, then B2B teams will pay for it because it
replaces both (i) their ad-hoc OneDrive + the recurring pain of assembling
packs, and (ii) the iDeals-tier incumbent they're forced onto for VC/M&A.

## Value

- **Time:** kills the per-request scramble to assemble vendor/VC packs.
- **Quality:** AI pre-validates docs against expected criteria before
  external eyes see them.
- **Professionalism:** having a structured, AI-queryable room removes a
  credibility tax in vendor registration and fundraising.
- **Stickiness:** once the room is populated and the Q&A is tuned, churn
  is low — same dynamic incumbents rely on.

## Success metric

MVP success = **3 paying customers within 3 months of v1 launch**, at
least one of which is external to Capital Pay's network. Leading indicator:
**≥1 vendor/RFP pack shared externally per month per customer**.

## Constraints

- **Time:** 6–10 weeks of Bradley's time, parallelised with axel+persistence.
- **Tech:** SST v4 + TypeScript baseline (from `sst-monorepo-template`).
  Claude API for AI. Stripe for billing. Storage = S3.
- **Security:** NDA-gated downloads, MFA, date-expiring invites, full
  audit log. Not SOC 2 at launch — targeted for Phase 2.
- **Legal:** Capital Pay dogfood happens as a commercial customer, not a
  special deal. Bradley to handle internal approvals himself.
- **Autonomy:** spec must be self-contained enough that a Claude Code
  agent can execute each feature slice without cross-session coordination.

## Scope (v0.1 MVP)

### Folder structure (opinionated, fixed at v0.1)

```
01_Company_Overview
02_Financials
03_Commercial
04_Product
05_Legal
06_Operations
07_Information_Security
Opportunities/
  Vendor_A/
  Vendor_B/
  ...
```

The seven numbered folders are the **canonical room** (`07_Information_Security` added at room-and-folders sign-off, 2026-07-16 — see `docs/product/fintech-vendor-pack-norms.md`). `Opportunities/` is
a container for per-external-party subrooms (vendors, VCs, RFP buyers),
each with scoped access to a subset of canonical folders + its own workspace.

### In (MVP v0.1)

- Auth + orgs + MFA; tiered roles (owner / admin / internal contributor /
  external viewer).
- The seven canonical folders + `Opportunities/` subrooms. Upload, preview,
  download, delete.
- **Doc checklist per canonical folder** — fixed template of required docs
  per category. Visible completion state drives self-service onboarding.
- **AI doc sense-check** — on upload, Claude classifies the doc and flags
  if it doesn't match the slot's expected criteria (e.g., uploading a
  marketing deck to `02_Financials` gets flagged).
- **Cited Q&A chat** — external viewers (and internal users) can ask
  natural-language questions, get answers grounded in uploaded docs with
  inline citations.
- **Access control** — date-expiring invites, revocable, per-category
  permissions on Opportunity subrooms, NDA acceptance gate before download.
- Admin dashboard: upload, invite/revoke, access log, checklist status.
- Stripe billing (one simple plan at launch).
- SST infra + observability baseline.

### Out (Phase 2+)

- Request-intercept + human-in-the-loop approval workflow.
- Learned approve/reject history for the agent.
- Scheduled maintenance prompts (quarterly doc review).
- M&A / VC fundraise workflow specialisation.
- Full RFP response automation.
- Internal knowledge-management mode (role-based internal KB).
- OneDrive / Google Drive sync.
- Watermarking, view-only previews, DRM.
- SOC 2 / ISO 27001 certification.

## Open questions

- Is **AI workflows at Capital Pay** (the priority-4 bucket) now _this_,
  or is it still separate? Need a decision so we don't double-count effort.
- Who's Curtis, and when do you want to pull him in for the vendor-submission
  workflow review (flagged in the Rob catchup action items)?
- Repo location: `mnt/projects/ai-data-room/` or under `personal/`? Needs
  to pick a GitHub org (Evans-Software-Solutions-Limited is the obvious
  fit since this is your SaaS, not Capital Pay's).
- ~~One plan at launch vs. tiered (free/starter/pro)?~~ **Resolved
  2026-07-16:** two published tiers + trial, per
  [ADR-013](../../adr/013-launch-pricing-model.md).

## Next step

Brief → **Feature-sliced Requirements phase**. Each feature slice gets its
own Kiro-style spec under `/specs/ai-data-room/<slice>/` with its own
`requirements.md` → `design.md` → `tasks.md`. Slice index and dependency
order lives in `/specs/ai-data-room/README.md`. No repo scaffolded until
the first slice's requirements are signed off.
