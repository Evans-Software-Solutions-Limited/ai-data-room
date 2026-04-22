# Requirements — ai-data-room / ai-doc-sensecheck

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-04-21
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `room-and-folders`, `doc-checklist`

## Context

When a document is uploaded and assigned to a checklist slot (e.g.
"Articles of Association" in `05_Legal`), an AI agent reads the document
and decides whether it plausibly **fits the slot**. The result surfaces
as a traffic light on the slot (green/yellow/red) plus a short
explanation. This is the "sense-check" that makes the checklist
self-serve at scale: uploaders get immediate, specific feedback rather
than waiting for an admin to eyeball every document.

This slice does **not** perform legal analysis, due diligence, or
content-level extraction of fields. It only answers: _"is this the kind
of document the slot asked for?"_

## Users & roles

- **Primary user:** internal contributor uploading a document.
- **Secondary users:** owner/admin reviewing flagged uploads.
- **Roles:** as defined in `auth-and-orgs`.

## User stories

- **US1** — _As an uploader, I want immediate feedback on whether my
  uploaded document fits the slot so I don't wait for admin review
  and can correct mistakes myself._
- **US2** — _As an uploader, I want a short plain-English explanation
  when the AI is unsure or disagrees, so I understand what to do
  next._
- **US3** — _As an owner/admin, I want to see a flagged queue of
  uploads the AI was unsure about so I can approve/reject quickly
  without reviewing every green-light upload._
- **US4** — _As an owner/admin, I want to override an AI decision
  (flip red → approved, or approved → rejected) with one click so
  we can always exercise judgement over the AI._
- **US5** — _As an owner/admin, I want AI decisions to carry a
  confidence score and a per-slot rule summary so I can see **why**
  the AI decided the way it did._
- **US6** — _As a security-conscious admin, I want the original
  document content to never leave our infrastructure (or at least
  Anthropic's boundary) — no third-party tooling._

## Functional requirements

### Decision pipeline

- **FR1** — On assignment of an uploaded document to a checklist slot,
  the system shall trigger an async sense-check job. The slot moves
  from `uploaded` directly to a transitional state `ai_checking`
  (visible in the UI) and emits an audit event.
- **FR2** — The sense-check job shall:
  1. Extract text from the document (PDF/DOCX/XLSX/PPTX/image OCR).
  2. Produce a summary bounded at **5,000 tokens** of extracted
     content to feed the model (budget-capping for cost).
  3. Call a Claude model (recommended **Claude Haiku 4.5** at v0.1
     for cost/latency; budget to upgrade to Sonnet on ambiguous
     slots if eval shows material gains).
  4. Output a structured decision: `{ decision: 'green'|'yellow'|'red',
confidence: 0-1, rationale: string, matched_criteria: string[],
missing_criteria: string[] }`.
- **FR3** — Mapping of decision → checklist state (from
  `doc-checklist` FR5):
  - `green` + `confidence ≥ 0.8` → slot → `approved` (auto-approve).
  - `yellow` or `red` or `green` with `confidence < 0.8` → slot →
    `uploaded` (stay pending) **and** flag in the admin review queue.
- **FR4** — Admins shall be able to set a per-org toggle:
  `auto_approve_green = true | false`. When `false`, **every** upload
  requires admin approval regardless of AI verdict; the AI explanation
  still shows. Default is `true`.
- **FR5** — The decision shall be associated with a **slot-specific
  criteria set** (from `doc-checklist` templates). The design phase
  decides the shape of that criteria set — at minimum a plain-English
  description of "what a good doc for this slot looks like".

### Admin review queue

- **FR6** — The system shall expose a review queue per org listing
  uploads with state `uploaded` that have an AI decision attached
  (i.e. not auto-approved). Each queue item shows: document, slot,
  AI decision, confidence, rationale, uploader, uploaded-at.
- **FR7** — An admin action on a queue item (approve / reject) shall
  transition the slot as in `doc-checklist` FR5 and audit-log the
  decision including the AI verdict that was overridden (if any).
- **FR8** — A document can be re-sense-checked by an admin on demand
  (e.g. after an admin edits the criteria for the slot). Each
  re-check creates a new decision record; the most recent applies.

### Performance, error, and fallback behaviour

- **FR9** — Sense-check shall complete within **60 seconds p95** for
  documents ≤10 pages / 5,000-token-extracted. Documents larger than
  the extract budget produce a `decision: 'yellow'` with rationale
  "document too large for automated sense-check — please review
  manually".
- **FR10** — If the AI call fails (timeout, rate limit, upstream 5xx,
  content policy refusal), the slot shall transition back to
  `uploaded` with a `yellow` decision carrying an explicit "AI
  check unavailable, manual review required" rationale. The failure
  is audit-logged. The queue item shows a "retry AI" button for
  admins.
- **FR11** — The system shall rate-limit itself to avoid spiking
  Anthropic API costs: **no more than 60 sense-check calls per org
  per minute** at v0.1. Over-rate submissions queue and are processed
  FIFO.

### Audit & observability

- **FR12** — Each AI decision shall be persisted with: document id,
  slot id, model used, prompt version id, confidence, verdict,
  rationale, matched criteria, missing criteria, input token count,
  output token count, latency, occurred-at. This record is the
  source of truth for admin UI and for eval datasets.
- **FR13** — The slice shall emit metrics suitable for tracking:
  auto-approval rate, false-approval rate (approved → later manually
  rejected), false-rejection rate (admin overrode red → approved),
  average latency, per-slot accuracy if slot populations allow.

### Uploader experience

- **FR14** — The UI shall present the AI verdict on the slot
  immediately the job completes, with: traffic light, one-sentence
  summary, expand-for-detail showing matched/missing criteria. If
  the slot was rejected (red + auto-reject? see §Open questions),
  the uploader can re-upload.

## Non-functional requirements

- **NFR1** — No document content shall be sent to any service other
  than Anthropic's API and our own AWS services.
- **NFR2** — PII in document content shall not be logged (no full
  document text, no OCR output) outside the encrypted decisions
  table. Only the summary-rationale is logged in clear.
- **NFR3** — The model, prompt template, and prompt version used for
  each decision shall be persisted with the decision (for
  reproducibility and eval).
- **NFR4** — Switching the default model (e.g. Haiku → Sonnet) shall
  be a configuration change, not a code change.
- **NFR5** — Per-org monthly sense-check calls shall be accounted
  toward a soft quota that the `billing-subscription` slice reads.
  v0.1 enforces a hard ceiling of **500 sense-checks per org per
  month** with admin-visible usage.
- **NFR6** — Model prompts shall be versioned in code; prompt
  regression must be testable via a golden-set eval harness (see
  §Open questions).

## Acceptance criteria

- **AC-US1** — An uploader uploads a plausible Articles of Association
  PDF into its slot. Within 60s, the slot shows a green tick with a
  one-sentence rationale and (if `auto_approve_green`) state becomes
  `approved`.
- **AC-US2** — An uploader uploads a cashflow forecast into the
  "Articles of Association" slot. The AI returns `red` with a
  rationale like "This looks like a cashflow forecast, not articles
  of association." The uploader sees the explanation clearly and can
  retry with a different document.
- **AC-US3** — An admin sees a queue of yellow-verdict items awaiting
  review; clicking "approve" on one transitions the slot to
  `approved` and records the override in the audit trail (including
  the overridden AI verdict).
- **AC-US4** — An admin manually rejects a green-verdict-auto-
  approved slot; the slot returns to `empty` and the decision
  history preserves the original AI green, the subsequent admin
  reject, and timestamps.
- **AC-US5** — The admin UI shows per-decision: model used, prompt
  version, confidence, matched/missing criteria — sufficient to
  understand why the AI decided the way it did.
- **AC-US6** — Anthropic outage: sense-check job fails. The slot
  returns to `uploaded` with the "AI unavailable" rationale. The
  uploader sees the situation clearly. An admin retries later and
  the decision completes normally.

## Non-goals (for this slice)

- Content-level due diligence (e.g. "do these accounts show negative
  equity?") → Phase 2 diligence analysis.
- Extracting structured fields from documents (director names, share
  counts, dates) → Phase 2 data room intelligence.
- Auto-populating other slots from one document → Phase 2.
- Multi-document cross-checks (e.g. "the cap table and shareholder
  register don't match") → Phase 2.
- Replacing admin approval with AI approval for **every** slot →
  explicit opt-in via `auto_approve_green`, never implicit.
- Third-party OCR providers → not used; Anthropic + in-house
  extraction only.
- Fine-tuned custom models → Phase 2.
- Eval harness productisation (letting customers tune their own
  criteria) → Phase 2 (`learned-approve-reject`).

## Open questions

- Auto-reject on `red` verdict, or always leave the decision to the
  uploader? Leaning **don't auto-reject** — put it in the admin
  queue as flagged-red but don't return the slot to empty without
  human confirmation. (Avoids frustrating uploaders when AI is
  wrong; preserves the document for admin review.)
- Golden-set eval harness: stand up in this slice, or as a separate
  internal tool? Leaning **ship with this slice** as a minimal
  CLI (`bun run eval:sensecheck`) — the risk of prompt regression is
  too high to defer.
- Claude Haiku 4.5 vs. Sonnet 4.6 at v0.1: Haiku likely sufficient
  for the "fit/don't fit" decision and ~5x cheaper — confirm during
  design via a small offline eval.
- Do uploaders see the AI rationale on auto-approved slots, or only
  on flagged ones? Leaning **show always** — transparency builds
  trust and users catch mistakes faster than admins will.
- Should the criteria set be editable per-org, or is it ours to
  maintain? Leaning **admin-editable per-org**, with our canonical
  criteria as the starting point. Tracks with `doc-checklist` FR4.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
