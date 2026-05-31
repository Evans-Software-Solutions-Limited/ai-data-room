# Requirements — ai-data-room / ai-search-qna

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-04-21
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `room-and-folders` (+ `access-control` for scoping)

## Context

Cited Q&A chat grounded in the room's documents. An authenticated user
asks a natural-language question; the system returns an answer with
inline citations (document + page / paragraph anchor) drawn **only from
documents the asker is permitted to read**. This is the feature that
differentiates us from every "secure file sharing" product on the
market — if search + Q&A aren't actually grounded in the room's content
and respectful of access control, the feature is worthless.

## Users & roles

- **Primary user:** internal contributor or owner/editor running
  diligence over the room.
- **Secondary users:** external viewers asking questions scoped to
  their Opportunity subroom.
- **Roles:** as defined in `auth-and-orgs`; access scoping enforced
  via `access-control`.

## User stories

- **US1** — _As an internal user, I want to ask "what's in our
  cash-flow forecast for Q3?" and get an answer with a citation back
  to the actual document and page._
- **US2** — _As an external viewer reviewing `Vendor_A`, I want to ask
  "what's the vendor's data retention policy?" and get an answer
  restricted to documents in my Opportunity subroom._
- **US3** — _As any user, I want the answer to explicitly say "I don't
  know" or "that's not in the room" rather than hallucinate._
- **US4** — _As any user, I want the answer to link directly to the
  source passage so I can verify it._
- **US5** — _As an owner/editor, I want a log of Q&A activity to be
  auditable — who asked what, what was answered — for compliance._
- **US6** — _As an owner/editor, I want to exclude specific documents
  from Q&A (e.g. a sensitive internal memo) while keeping them
  visible in the room._

## Functional requirements

### Indexing pipeline

- **FR1** — On document upload (via `room-and-folders`) **and**
  approval (via `doc-checklist` / `ai-doc-sensecheck`), the system
  shall enqueue the document for indexing into a vector store. Only
  `approved` documents are indexed at v0.1; `uploaded-but-pending`
  documents are excluded until approved.
- **FR2** — Indexing shall extract text per page / slide / sheet,
  chunk it into passages bounded at **~1,000 tokens** with ~200-token
  overlap, embed each passage, and persist `{passage_id, doc_id,
anchor (page/slide/sheet number + offset), vector, text}`. Anchors
  are what we render as citations.
- **FR3** — On document deletion (soft or hard) or slot reset to
  `empty` / `rejected`, the system shall delete the corresponding
  passages from the vector store within 5 minutes.
- **FR4** — On access-grant revocation (via `access-control`), future
  queries from the revoked user shall immediately stop returning
  passages from newly-forbidden documents. Index-level changes are
  not required; scoping happens at query time (FR6).

### Query flow

- **FR5** — An authenticated user's query shall:
  1. Expand into an embedding vector.
  2. Run approximate-nearest-neighbour search against the vector store.
  3. Filter candidates to passages the user is allowed to read via
     `access-control` (by doc visibility to the user's grants).
  4. Re-rank top candidates (top-50 → top-10) via a lightweight
     cross-encoder or prompt-based re-rank.
  5. Pass the re-ranked top-N (bounded by context budget, target N=8)
     into a generator prompt that:
     - Cites every claim with `[doc_id#anchor]` tokens.
     - Explicitly answers "I don't know" when no passage supports
       the question.
- **FR6** — Access-control filtering shall happen **before** the
  passages are sent to the model. No passage the user isn't allowed
  to read may appear in the model's context at any step.
- **FR7** — The system shall support **thread-style** conversations —
  the user can ask a follow-up that references "it" or "the previous
  answer", and the retriever receives the prior turns to improve
  recall.
- **FR8** — The generator shall return a structured response:
  `{ answer: string, citations: Array<{ passage_id, doc_id, anchor,
snippet }>, unanswered_reason: string | null }`.
- **FR9** — The UI shall render answers with clickable citations that
  open a document preview scrolled/paged to the cited anchor.
- **FR10** — For queries where the retriever returns nothing in the
  user's scope, the system shall respond "I couldn't find anything in
  the documents you have access to that answers this" rather than
  attempting a model-only answer.

### Admin controls

- **FR11** — Owners/admins shall be able to flag a specific document
  as **excluded from Q&A** (per FR6 of user stories). Excluded docs
  remain visible in listings (subject to `access-control`) but are
  removed from the vector store and never appear in an answer.
- **FR12** — Owners/admins shall be able to view a per-org Q&A
  activity feed: asker, timestamp, question, top 3 citations returned,
  answered/unanswered. Full admin UI lives in `admin-dashboard`; this
  slice exposes the API.

### Audit & observability

- **FR13** — Every Q&A call shall produce an audit event with:
  asker user id, org id, Opportunity scope (for external users),
  question text, answer id, cited doc ids, unanswered flag, model +
  prompt version, latency, input + output token counts.
- **FR14** — The system shall emit metrics: queries per org,
  "I don't know" rate, mean citations per answer, mean latency p50
  and p95, retrieval recall proxy (citation click-through).

### Rate limits & cost guardrails

- **FR15** — Per-user rate limit: **20 questions per minute**.
  Per-org soft monthly quota: **2,000 questions per org per month**
  at v0.1 (enforced by `billing-subscription` where that slice
  exists; this slice enforces the hard ceiling).
- **FR16** — Answer generation shall be capped at **~1,000 output
  tokens** at v0.1; longer answers are truncated with a "truncated"
  flag in the response.

## Non-functional requirements

- **NFR1** — No passage content shall leave Anthropic + our AWS
  infrastructure. Vector store hosted in-VPC (pgvector extension on
  our Postgres, matching FDP posture, or a managed equivalent — to be
  confirmed in design).
- **NFR2** — Query latency target: **p50 ≤ 3s, p95 ≤ 8s** end-to-end
  for a fresh query with no cached embedding.
- **NFR3** — Citation correctness — the cited passage must be
  retrievable as the exact text the model was shown. Evals shall
  verify that citations resolve to real passages (no hallucinated
  anchors). Golden-set eval included in this slice.
- **NFR4** — The system shall be model-agnostic for the generator —
  switch from Sonnet to Opus or vice-versa via configuration.
- **NFR5** — Indexing backlog shall have a max age metric; if a
  document remains unindexed for >10 minutes post-approval, alert.
- **NFR6** — Embeddings and passage text shall be encrypted at rest
  (KMS-managed).

## Acceptance criteria

- **AC-US1** — An internal user asks "what's our cash runway?" in a
  populated room. The answer references the correct cash-flow
  document, with a citation that opens the document at the right page.
- **AC-US2** — An external viewer of `Vendor_A` asks a question about
  another Opportunity; the answer is "I couldn't find anything in the
  documents you have access to..." — no information about `Vendor_B`
  leaks.
- **AC-US3** — A user asks an answerless question ("what's the CEO's
  favourite colour?" in a financials-only room). The answer is
  explicitly "I don't know" — not a hallucination.
- **AC-US4** — Clicking a citation opens a preview of the cited doc
  at the cited page with the cited passage highlighted (where the
  viewer supports highlighting) or the anchor page rendered.
- **AC-US5** — An admin reviews the Q&A activity feed and sees the
  full text of every question asked by external viewers in the last
  30 days with the cited docs.
- **AC-US6** — An admin flags `secret_memo.pdf` as excluded from
  Q&A; within 5 minutes, no subsequent Q&A returns it as a citation
  even if it's still listed in `05_Legal`.

## Non-goals (for this slice)

- Document summarisation beyond Q&A answer — Phase 2 ("summarise
  this folder" / "produce a diligence memo").
- Structured field extraction across the room — Phase 2.
- Cross-room search (across multiple orgs) — never; privacy boundary.
- Claude generating SQL over structured spreadsheets — Phase 2 (data
  room intelligence).
- Voice Q&A — Phase 2.
- Offline / export-able reports — Phase 2.
- User-facing prompt-template customisation — Phase 2.
- Third-party vector databases (Pinecone, Weaviate, etc.) at v0.1 —
  pgvector in-VPC only.

## Open questions

- pgvector vs. dedicated vector store (OpenSearch, AWS Bedrock
  Knowledge Bases): leaning **pgvector** for v0.1 to minimise new
  infra; revisit if recall/latency disappoints.
- Re-ranker model — cross-encoder (self-hosted, small) vs.
  prompt-based re-rank via Haiku: leaning **Haiku prompt-based** for
  simplicity at v0.1.
- Conversation memory window — how many prior turns to include in
  retrieval? Leaning 3 user-turns + 3 assistant-turns, hard-capped.
- Do we support cross-doc references in a single answer ("the article
  says X, which contradicts the accounts on page 3")? Leaning
  **yes** — that's the diligence value; no additional engineering,
  just prompt design.
- Should "I don't know" answers still create an audit event? Leaning
  **yes** — the question itself is a compliance signal worth logging.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
