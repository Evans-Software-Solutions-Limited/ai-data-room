# Requirements — ai-data-room / doc-checklist

**Status:** draft
**Owner:** Bradley (Curtis as vendor-workflow SME)
**Last updated:** 2026-04-21
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `room-and-folders`

## Context

This is the feature that turns a folder into a **self-managing checklist**.
For each of the six canonical folders (and optionally each Opportunity
subroom), there is a predefined list of document **slots** — e.g. in
`05_Legal`: Articles of Association, Certificate of Incorporation,
Shareholder Register. Uploading a doc fills a slot. The UI surfaces a
completion percentage and "what's missing" so the client can self-serve
the room without a human walking them through it. This slice **defines
the templates and tracks state**; it does not decide **whether a doc
actually fits the slot** — that's `ai-doc-sensecheck`.

## Users & roles

- **Primary user:** internal contributor filling the checklist for
  their org.
- **Secondary users:** owner/admin customising the checklist and
  approving completions; external viewers seeing which slots are
  populated (where applicable to their Opportunity grant).
- **Roles:** as defined in `auth-and-orgs`.

## User stories

- **US1** — _As a new org, I want a pre-populated checklist for each
  of the six canonical folders so I know exactly what to upload._
- **US2** — _As an internal contributor, I want to upload a document
  against a specific slot (e.g. "Articles of Association") so the
  system knows that slot is filled._
- **US3** — _As an internal contributor, I want to see a completion
  percentage per folder and overall so I can report progress back to
  the team._
- **US4** — _As an internal contributor, I want to mark a slot as
  "not applicable" with a reason so I'm not blocked by items that
  genuinely don't apply to our business._
- **US5** — _As an owner/admin, I want to add custom slots to a
  folder (e.g. a bespoke vendor questionnaire in `03_Commercial`) so
  the checklist reflects our business._
- **US6** — _As an owner/admin, I want to approve or reject a slot's
  uploaded document so the checklist reflects verified state, not
  just "something was uploaded"._
- **US7** — _As an external viewer, I want to see which slots are
  complete/missing in the Opportunity subroom I was invited to so I
  can chase the counterparty or proceed with diligence._

## Functional requirements

### Templates

- **FR1** — The system shall ship a **canonical template set** at v0.1,
  one per canonical folder:
  - `01_Company_Overview` — pitch deck, company summary, team bios,
    cap table summary.
  - `02_Financials` — latest audited accounts, management accounts
    (last 3 months), cash flow forecast (12m), P&L by month (last 12m),
    bank statements (last 3 months).
  - `03_Commercial` — customer list, top-10 contracts, pricing sheet,
    churn analysis.
  - `04_Product` — product roadmap, tech stack overview, security
    summary, uptime SLA history.
  - `05_Legal` — Articles of Association, Certificate of Incorporation,
    Shareholder Register, material contracts, IP register.
  - `06_Operations` — org chart, key policies (privacy, IT, HR),
    insurance certificates, supplier list.
  - **Canonical content TBD with Curtis** in the design phase; this
    requirements doc fixes the shape, not the exact wording.
- **FR2** — Each slot in a template shall have: `slot_id`, `title`,
  `description`, `guidance` (markdown, optional), `required` flag,
  `expected_file_types` (subset of the MIME types `room-and-folders`
  supports).
- **FR3** — Opportunity subrooms shall have a **default per-
  Opportunity template** (e.g. "Vendor Onboarding" = one slot per
  vendor questionnaire category). Admins may override the default
  on subroom creation. Default set TBD with Curtis.
- **FR4** — The system shall ship an **admin-editable template** per
  org: an admin can add, edit, hide, or reorder slots within their
  org's copy of a template without affecting other orgs. The canonical
  template serves as the starting point on org creation.

### Slot state

- **FR5** — Each slot shall be in exactly one of the following states:
  - `empty` — no document uploaded.
  - `uploaded` — document uploaded, awaiting validation (AI or
    admin — see `ai-doc-sensecheck` for AI pathway).
  - `approved` — document verified as fitting the slot.
  - `rejected` — document rejected; the slot returns to `empty` and
    the reason is audit-logged and shown to the uploader.
  - `not_applicable` — marked N/A with a user-entered reason.
- **FR6** — On document upload into a folder (via `room-and-folders`),
  the uploader shall be required to choose a slot, or explicitly
  choose "other / uncategorised". Uncategorised uploads do not count
  toward checklist completion.
- **FR7** — Owners/admins shall be able to override a slot's state
  (approve an uploaded document, mark a slot N/A, re-open an approved
  slot). Overrides are audit-logged.

### Completion tracking

- **FR8** — For any folder, the system shall compute:
  - `total_required_slots` — count of `required=true` slots not in
    state `not_applicable`,
  - `completed_required_slots` — count of the above that are in state
    `approved`,
  - `completion_percentage` — 100% when `total_required_slots == 0`,
    else `completed / total * 100`.
- **FR9** — The system shall expose a room-level completion summary
  that rolls up canonical-folder completion and per-Opportunity
  completion.

### Visibility

- **FR10** — Internal users shall see the checklist state for all
  folders they can see. External users shall see the checklist state
  only for Opportunity subrooms they have a grant for, subject to the
  permission tier (see `access-control`).
- **FR11** — A slot's uploaded document shall only be viewable by
  users who would be allowed to view that document via
  `access-control`. Checklist state (slot exists, slot is approved)
  is viewable whenever the folder is viewable, even when the
  underlying document is not.

### Audit

- **FR12** — The slice shall emit audit events for: slot approved,
  slot rejected (with reason), slot reset to empty, slot marked N/A,
  slot N/A cleared, template customised (add / edit / hide / reorder),
  uploader assigned doc to slot, uploader chose "uncategorised".

## Non-functional requirements

- **NFR1** — Completion computation shall be O(slots-in-folder) and
  return in ≤100ms p95 for a folder with ≤50 slots.
- **NFR2** — Template customisation shall not affect other orgs; each
  org has its own copy of the template tree after org creation.
- **NFR3** — Changing a slot from `required` to optional, or deleting
  a slot that has an uploaded document, shall **preserve the uploaded
  document** (move to uncategorised, not delete).
- **NFR4** — Admin approvals shall be idempotent; repeated approval
  of the same slot produces exactly one audit event per state
  transition, not per click.
- **NFR5** — The template shape shall be forward-compatible with
  Phase-2 "RFP mode" and "M&A mode" templates — no schema break
  anticipated when those land.

## Acceptance criteria

- **AC-US1** — A new org sees the canonical checklist in each of the
  six folders immediately, with every slot in state `empty`.
- **AC-US2** — An internal user uploads `accounts_2024.pdf` into
  `02_Financials` and selects the "Latest audited accounts" slot;
  the slot state becomes `uploaded` (or `approved` / `rejected`
  after `ai-doc-sensecheck` runs — but that slice's behaviour is
  simulated/stubbed here with a manual admin approval pathway).
- **AC-US3** — The `02_Financials` folder view shows a completion bar
  (e.g. "2 of 5 required slots complete, 40%"); the room-level
  summary aggregates correctly across all folders.
- **AC-US4** — An internal user marks "Shareholder Register" as N/A
  with reason "sole trader"; the slot no longer counts toward
  required completion; admins see the N/A reason.
- **AC-US5** — An admin adds a custom slot "Vendor security
  questionnaire v3" to `Opportunities/Vendor_A` and it appears in
  that subroom's checklist without affecting any other org or
  subroom.
- **AC-US6** — An admin approves the uploaded `accounts_2024.pdf`;
  slot state becomes `approved`; re-opening it to `empty` is
  reflected and audit-logged.
- **AC-US7** — An external viewer of `Vendor_A` with `viewer` tier
  sees the Vendor_A checklist and slot states, and — per
  `access-control` — can preview but not download, while seeing
  "approved/empty/N/A" state on each slot.

## Non-goals (for this slice)

- AI validation of whether the upload actually fits the slot →
  `ai-doc-sensecheck` slice.
- Per-Opportunity template authoring UI for external users → never;
  admins only.
- Bulk-import of checklist templates across orgs / "marketplace" →
  Phase 2.
- Document expiry (e.g. "insurance certificates expire annually") →
  Phase 2.
- Reminder emails ("you still have 3 required slots empty") →
  Phase 2; product-level email (not auth email) slice.
- RFP-mode and M&A-mode template sets → Phase 2.

## Open questions

- Should `expected_file_types` default to all supported types or only
  a narrow set per slot (e.g. PDF-only for Articles of Association)?
  Leaning **narrow** — feeds better into `ai-doc-sensecheck` and sets
  expectations for the uploader.
- Should "uncategorised" uploads auto-suggest a slot (pre-AI sensecheck)
  based on filename heuristics? Leaning **no** at v0.1 — the AI
  slice handles this more reliably; filename matching is noisy.
- Do we need approvals at all, or is `uploaded` == good-enough at
  MVP? Leaning **keep approvals** — it's the interface through which
  Capital Pay and other early customers get their sign-off control
  without us building an approval workflow later.
- Curtis-driven slot list finalisation — should we meet with Curtis
  during the **requirements** phase of this slice or during **design**?
  Leaning **design**, so we're not blocked here on SME availability.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
