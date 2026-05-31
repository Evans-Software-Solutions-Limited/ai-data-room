# v1.0-MVP Design Brief — `datum/room`

**Status:** draft (distilled from `proto/v1-mvp-design` prototype, 2026-05-27)
**Source prototype:** 6 static HTML screens + 1553-line stylesheet, local-only on branch `proto/v1-mvp-design`. Will not be pushed to remote.
**Use:** paste this whole file into a Claude design session to drive iteration on the v1 surface. The prototype establishes the design language; this brief is its written contract.

---

## 1. Product context (one paragraph)

`datum/room` is an AI-native secure data room. Founders, ops leads, and
compliance owners at B2B SMEs assemble a canonical six-folder room
(`01_Corporate/`, `02_Financials/`, `03_Legal/`, `04_Commercial/`,
`05_Operations/`, `06_People/`) and create scoped `Opportunities/`
subrooms when they need to share a curated subset of the canonical
room with an external party (bank, investor, M&A buyer, RFP issuer).
Three product differentiators define the surface: (1) **AI sense-check** —
every uploaded document is classified by Claude and flagged when its
classification disagrees with the folder it was dropped into; (2) **cited
Q&A** — natural-language search returns answers grounded in source
documents with inline citation chips; (3) **scope-aware sharing** —
external viewers see only the folders + files explicitly scoped into
their opportunity, never the host room. The first paying customer is
Capital Pay (Bradley's incoming CTO seat), but `datum/room` is shipped
as its own brand, not as a Capital Pay-internal tool.

## 2. Three design decisions baked into the prototype

The prototype's commit body flagged three open design questions. The
prototype answers all three; this brief surfaces those answers so they
can be confirmed or redirected before the design surface goes further.

### 2.1 Wordmark

**Decision in prototype:** `datum/room`. Serif at 15px, bold, with the
`/room` half rendered in italic + secondary gray. Used in the brand
corner of every screen (top-left, 260×56 cell of the layout grid).

**Implication:** the product is named `datum/room`. The repo name
`ai-data-room` is the codename / GitHub slug, not the marketing
identity. Capital Pay (and any future tenant) shows up only as an
org-pill on the top bar.

### 2.2 The amber accent (`#b8742a`) vs the Capital Pay brand

**Decision in prototype:** a single accent — `#b8742a` "signal amber" —
reserved exclusively for AI-derived surfaces (sense-check badges,
citation chips, Q&A chrome, AI-suggested checklist items, AI activity
in the feed). Capital Pay's brand appears nowhere in the chrome
beyond the org pill.

**Implication:** `datum/room` is positioned as a standalone SaaS
product. Capital Pay is a tenant, not a parent brand. The amber
serves as the product's only branded colour; the rest is "ink on
paper" neutrals. Any future co-branding (e.g. tenant logo in the
sidebar) would need to fit alongside the amber-only AI signal without
diluting it.

### 2.3 Dark mode

**Decision in prototype:** **no dark mode in v1.** The stylesheet has
no `prefers-color-scheme` media queries, no `--paper-dark` /
`--ink-dark` variables, no theme toggle. The CSS header explicitly
notes "No dark mode (yet)."

**Implication:** ship v1 light-only. Adding dark later requires a
full parallel palette (~18 named colours) plus revisiting the amber
accent against a dark background — `#b8742a` reads well on `#f7f5f0`
but may need to brighten on dark surfaces.

---

## 3. Design system

### 3.1 Palette — "ink on paper"

Two axes: warm-neutral paper tones for surface + warm-neutral ink for
text. No pure black, no pure white, no gradients, no glow effects.
A **single chromatic colour** (`#b8742a`) carries every AI-derived
signal — that visual contract is load-bearing.

| Token         | Hex       | Role                                                          |
| ------------- | --------- | ------------------------------------------------------------- |
| `paper`       | `#f7f5f0` | Primary page background (warm off-white)                      |
| `paper-2`     | `#efece4` | Sidebar / secondary surfaces                                  |
| `paper-3`     | `#e5e0d3` | Hover / tertiary                                              |
| `card`        | `#ffffff` | Lifted surfaces (cards, inputs)                               |
| `rule`        | `#d8d2c1` | Hairline dividers                                             |
| `rule-strong` | `#b8b09a` | Stronger borders                                              |
| `ink`         | `#1a1815` | Primary text                                                  |
| `ink-2`       | `#4a463d` | Secondary text                                                |
| `ink-3`       | `#7a7468` | Tertiary text + metadata                                      |
| `ink-4`       | `#a8a190` | Placeholder + disabled                                        |
| **`signal`**  | `#b8742a` | **AI accent — used nowhere else**                             |
| `signal-bg`   | `#fdf6ec` | Signal background tint                                        |
| `signal-deep` | `#8a4f15` | Signal foreground when on signal-bg                           |
| `signal-rule` | `#e8c896` | Signal-tinted borders                                         |
| `ok`          | `#3f6b4a` | Success — deliberately desaturated to not compete with signal |
| `warn`        | `#a86d1a` | Warning (non-AI)                                              |
| `err`         | `#8e2f2a` | Error                                                         |
| `pending`     | `#6c6660` | Pending / in-progress                                         |

**Critical invariant.** The amber accent is reserved for AI output —
sense-check, citation chips, AI suggestions, AI activity dots, Q&A
composer icon, the AI-corner indicator. **Status states use the
status palette (ok / warn / err), not amber.** Mixing them would
break the "amber = AI is talking" contract that makes the product
legible at a glance.

### 3.2 Typography — three-family editorial stack

Editorial-grade serif intentionally chosen over the default
SaaS-sans aesthetic. Three families, each pinned to a role:

- **Source Serif 4** (400 / 500 / 600 / 700) — display titles, card
  headings, body copy in narrative contexts, and the entire Q&A
  surface (user prompt + AI answer both render in serif).
- **Inter** (400 / 500 / 600 / 700) — UI chrome, buttons, labels,
  table cells with no specifically-narrative content.
- **JetBrains Mono** (400 / 500 / 600) — data tables, identifiers,
  audit logs, timestamps, count / metric values. Tabular numerals
  enforced globally via `font-feature-settings: 'tnum'`.

Display: 32px serif/600. Card heading: 18px serif/600. Body: 14px
inter/400 line-height 1.5. Q&A answers: 17px serif/400. Metadata
labels: 10–11px mono uppercase with 0.10–0.12em letter-spacing.

The mono numerals carrying _every_ count / money / progress
percentage value is a deliberate hum — the product looks
finance-grade because the numbers read finance-grade.

### 3.3 Spacing, sizing, radius

- 12px grid rhythm. Card padding 18px. Checklist rows 10–11px vertical. Main pane padding 32/48.
- Sidebar: 260px fixed. Top bar: 56px fixed.
- Radius tokens: `--radius-sm: 3px`, `--radius: 5px`, `--radius-lg: 8px`. Status pills use `border-radius: 999px`.

### 3.4 Shadows

Two layers only:

- `--shadow-1` — subtle (`0 1px 0 rgba(…,0.04), 0 1px 2px rgba(…,0.06)`). Inputs, pills.
- `--shadow-2` — slightly bolder (`0 2px 4px + 0 4px 12px`). Wizard modal.

No drop shadows for "depth"; no neon glow; no inner shadows.

### 3.5 Component patterns

**Sense-check badge (`.sc`).** The most-repeated AI surface — appears
in document tables, checklists, opportunity scope cards. 11px mono,
rounded pill, 5px leading dot:

| Variant     | Foreground | Background | Dot        | When                                                   |
| ----------- | ---------- | ---------- | ---------- | ------------------------------------------------------ |
| `.match`    | `#3f6b4a`  | `#ecf1ec`  | green      | Classification matches the folder the doc sits in.     |
| `.mismatch` | `#8a4f15`  | `#fdf6ec`  | amber      | Classification disagrees with location — user action.  |
| `.pending`  | `#6c6660`  | `#ece9e1`  | gray pulse | AI is still classifying. Pulses to signal in-progress. |

**Citation chip (`.cite`).** Inline reference in AI Q&A answers.
Monospaced, amber background (`#fdf6ec`), amber-deep text
(`#8a4f15`), amber-rule border. Hover lifts to `#f8e6ca`. Sits
inline with the serif answer text — readable density without
visual noise.

**AI surface (`.ai-surface`).** Bordered container with amber tint
and a two-stroke top-left corner indicator (24px, 2px amber). The
corner is the silent marker that says "this whole block is AI
output, not human-curated content." Used on the workspace home's
priority-alert card, the folder view's mismatch callout, the
onboarding wizard's classification result.

**Buttons.** Four variants:

| Variant   | Background | Text    | Border   | When                                               |
| --------- | ---------- | ------- | -------- | -------------------------------------------------- |
| `default` | `card`     | `ink`   | 1px rule | Standard secondary action.                         |
| `primary` | `ink`      | `paper` | —        | Primary affirmative ("Continue", "Looks right").   |
| `signal`  | `signal`   | `#fff`  | —        | AI-initiated action ("Re-classify", "Send to AI"). |
| `ghost`   | —          | `ink-2` | —        | Cancel / inline / low-emphasis.                    |

All 13px Inter/500, 7px vertical padding.

**Tabs (admin).** Underlined style, 13px medium. Active tab has
solid ink bottom border. Count badges in 10px mono on `paper-2`.

**Status pills.** 11px mono, rounded 999px, status-palette colour
fg + tinted bg. Three flavours (ok / warn / err) plus `idle`
(neutral gray).

**Activity feed dots.** Three colours signal kind-of-action:

- Amber `signal` → AI did something (classified, flagged, suggested).
- Green `ok` → external-action success (signed NDA, accessed doc).
- Gray `ink-3` → internal-action neutral (uploaded, renamed).

---

## 4. AI as a first-class surface (cross-cutting)

The single hardest thing to get right in this product is the visual
language for "AI is doing something here." The prototype establishes
five orthogonal signals, all keyed off the amber accent:

1. **Amber colour** itself, reserved for AI surfaces only.
2. **Diamond glyph (◆)** prefixing AI labels (`.ai-label`) and AI
   activity dots in feeds.
3. **Two-stroke corner indicator** on `.ai-surface` containers.
4. **Monospaced uppercase label** ("AI SENSE-CHECK", "AI SUGGESTED",
   "AI FLAG") sitting above amber-tinted blocks.
5. **Italic secondary text** in AI sub-explanations (the "we think
   this doc belongs in 02_Financials because …" hint below a
   mismatch badge).

A user scanning a page should be able to answer "which of this is
the AI talking?" in under a second by following the amber. Anything
amber is AI; anything not amber is either content or chrome.

---

## 5. Per-screen briefs

Each screen follows the same shell — fixed 260px left sidebar +
fixed 56px top bar + scrollable main pane. The sidebar holds three
sections (Canonical room / Opportunities / Workspace). The top bar
holds breadcrumb + org pill + user chip. Per-screen variation is in
the main pane.

### 5.1 Workspace home

**Purpose.** Daily landing. Surfaces the things that need the user's
attention today and the room's health snapshot.

**Layout.** Welcome header → 4 stat tiles → 2-column body (2fr
priorities + activity / 1fr quick-ask + pinned docs).

**Components, in visual prominence order:**

1. Welcome header — 40px serif, italic accent on the user's first
   name.
2. **Priority cards row** — 3 cards. Left card is wider (1.5fr) and
   carries an amber left border + `.ai-label` "AI SENSE-CHECK NEEDS
   REVIEW"; the two right cards (1fr each) are non-AI alerts (e.g.
   "Pending invitation expires Friday").
3. Four stat tiles — completion %, active opportunities count,
   sense-check flag count, Q&A queries this week. Tabular mono.
4. Recent activity feed (left column, 6 items) — dotted bullets
   coloured by kind-of-action.
5. **Quick-ask card** (right column) — amber tinted, prompts "ask
   anything about your room…" and links to the Q&A screen.
6. Pinned documents (right column, below quick-ask) — 3 checklist
   rows with sense-check badges.

**AI surfaces.** Priority lead card, quick-ask, AI dots in activity.

**Unique-to-this-screen.** The "lead priority" card pattern (1.5fr

- amber border + AI label). Don't replicate it elsewhere — its
  visual heaviness is what earns the user's first attention each day.

### 5.2 Folder view (`02_Financials`)

**Purpose.** Canonical-folder content management. The user lands
here to upload missing required docs, review sense-check flags, and
manage the folder's per-document state.

**Layout.** Header (eyebrow + serif title + 3 action buttons) →
required-docs checklist card → mismatch callout (conditional) →
documents table.

**Components:**

1. Required-docs checklist card — 11 items per the canonical
   `02_Financials` template (e.g. "Last 3 years annual accounts",
   "Latest management accounts", "Cap table"). Each row carries a
   checkbox state + sense-check state. Progress bar at the top of
   the card fills amber if any sense-check flag is present;
   otherwise fills ink.
2. **Mismatch callout** (amber `.ai-surface`, full-bleed) — appears
   when the AI has classified an upload into this folder but
   thinks it belongs elsewhere. Carries two actions: "Move to
   `<suggested folder>`" (primary) and "Override — keep here"
   (ghost).
3. Documents table — 11 rows, 7 columns: icon, filename
   (serif/500), AI classification (mono small), uploader,
   timestamp, sense-check badge, actions menu.

**AI surfaces.** Checklist progress bar fill colour, sense-check
column, mismatch callout.

**Unique-to-this-screen.** The two-state progress bar (ink fill in
the healthy case, amber fill the moment a mismatch lands) — turning
the _progress_ itself into an AI signal is the screen's strongest
move.

### 5.3 Cited Q&A

**Purpose.** Natural-language sense-making across the room's
documents, with inline citations the user can audit.

**Layout.** Two-column. Main column (`1fr`, full-height chat) +
right rail (`340px` source list).

**Components:**

1. Header — title + scope pills (e.g. "across 187 documents",
   "scope: full room").
2. Conversation turns:
   - User prompt — serif 15.5px/500.
   - AI answer — serif 17px/400, with `.cite` chips inline
     ("…confirmed in [01_Corporate / Shareholders Agreement]…").
   - **Confidence bar** below each answer — amber-tinted, shows
     `84%` numeric + mini fill bar.
3. Sticky composer at the bottom — amber diamond icon, input
   field, monospaced "↵" return-key hint, three suggested
   follow-up questions ("Show me cap table changes since 2024",
   "Who's signed the NDA?", etc.).
4. **Source rail** (right) — numbered cards 1-4. Each card shows
   folder path, document title (serif), italicised snippet with
   left border. Numbering matches the inline `[1]` / `[2]` chip
   references.

**AI surfaces.** Entire screen, effectively — but the citation
chips and the source rail are what makes the AI's claim auditable.

**Unique-to-this-screen.** Editorial serif body type on a chat
surface. Most chat UIs default to sans; using serif here positions
the AI's answers as written-prose-the-user-can-read rather than
machine-output-to-be-scanned.

### 5.4 Opportunity subroom (Stripe Inc.)

**Purpose.** Manage external viewer access + scoped document
sharing for a single deal. The host-org user lands here to invite
externals, watch what they're accessing, and revoke when the deal
closes (or doesn't).

**Layout.** Header → NDA banner (conditional) → scope card →
external viewers table → scoped documents table.

**Components:**

1. Header — eyebrow "external", title "Stripe Inc.", subtitle
   ("Series C funding diligence"), action buttons (invite, edit
   scope, revoke all).
2. **NDA banner** (amber `.ai-surface`, info-shaped) — lists
   external viewers who haven't signed yet. Not blocking;
   informational. Also surfaces AI suggestions ("Stripe asked
   three times for `cap-table-2025.pdf` — it's not in scope").
3. Scope card — two columns: folders granted (ok green
   checkmark) + folders denied (struck-through, ink-3 text). Below
   the two columns: a small per-document list with status pills
   (e.g. "uploaded", "pending sense-check", "missing").
4. External viewers table — 4 rows. Columns: avatar + name +
   email, NDA status pill (`signed`/`pending`/`declined`),
   last-seen timestamp, downloads count, actions menu.
5. Scoped documents table — 18 rows. Columns: filename, folder,
   uploaded-by, last opened by external (with viewer avatar),
   sense-check badge.

**AI surfaces.** NDA banner's AI suggestion sub-line, sense-check
column in the doc table, scope-granted folder verification.

**Unique-to-this-screen.** Folders-denied are visually
present-but-struck-through, not hidden. The host-org user
should see _what's not shared_ alongside _what is_, so they
can confidently say "yes, the buyer cannot see HR" without
having to derive it from absence.

### 5.5 Admin dashboard (tabbed)

**Purpose.** Observability across activity, access, checklist
health, and audit. Single screen, four tabs.

**Layout.** Tabs at top (Activity / Access / Checklist health /
Audit log) + per-tab body.

**Tab: Activity.** 4 stat tiles (uploads, external downloads, Q&A
queries, flags raised) → 2-column grid (activity feed left + Q&A
trends with AI suggestion right).

**Tab: Access.** 3 stat tiles (active external viewers, pending
invites, revocations in last 30d) → active viewers table → pending
invites table.

**Tab: Checklist health.** 3 stat tiles (canonical completion %,
open flags, oldest missing doc) → folder-by-folder progress table
(6 rows, one per canonical folder).

**Tab: Audit log.** Filterbar (user / action / date range /
search) → audit table (timestamp, verb badge, what, actor, IP).
**Verb badges** are colour-coded: `READ`/`WRITE` use
ink-on-paper-2, `INVITE`/`REVOKE` use ok/err, `FLAG`/`CLASSIFY`
use signal. The amber on `FLAG`/`CLASSIFY` is what makes
AI-driven entries scannable in a long log.

**AI surfaces.** Q&A trends AI suggestion (Activity tab),
sense-check flag stats (Checklist tab), `FLAG`/`CLASSIFY` verb
badges (Audit tab).

**Unique-to-this-screen.** The verb-badge colour key in the audit
log. Lets a compliance reader scan a 500-row audit log and find
all AI-driven entries without filtering.

### 5.6 Onboarding wizard

**Purpose.** First-run setup. Demonstrates the AI sense-check
within the first 60 seconds of the user's product experience.

**Layout.** Centred modal (540px max-width), shown mid-flow at
step 3 of 4. Below the modal: a four-step thumbnail strip showing
where in the flow the user is.

**Components:**

1. Wizard head — step counter (1 / 2 / **3** / 4 with current
   step in amber), serif title ("Here's what we think you have"),
   subtitle.
2. **AI surface body** — explains what the AI saw on the uploaded
   doc ("We classified this as a Series A term sheet, 92%
   confidence") + recommended checklist (4 items with three
   states: auto-filled / suggested / incomplete).
3. Footer — progress dots + "Customise" (ghost) + "Looks right"
   (primary).
4. Four-step flow strip — steps 1 & 2 marked done (ok green),
   step 3 current (amber), step 4 future (faded).

**AI surfaces.** Entire body. The whole step exists to surface
the AI's classification + suggestion in the first 60 seconds.

**Unique-to-this-screen.** Step 3 is the entire AI value pitch
compressed into one moment — the user uploaded one document; the
AI built them a checklist. If this step doesn't land, the rest
of the product doesn't matter.

---

## 6. Notes for the Claude design session

Things to push on:

- **Empty / loading / error states.** The prototype hints at these
  (the pulsing `.pending` sense-check dot, the placeholder rows)
  but doesn't cover them comprehensively. Worth iterating to
  cover: first-empty-room state, zero-flags state, zero-documents
  state, Q&A with no documents indexed, opportunity with no
  external viewers, audit log filtered to nothing.
- **Mobile / responsive.** Prototype is desktop-first. The product
  is desktop-primary (compliance / data-room work is desk work)
  but external viewers will sometimes open invites on phones.
  Worth at least sketching a phone-shaped read-only viewer surface
  for the Opportunity screen.
- **Notifications.** Email digest of "what happened in your room
  this week" is implied by the activity feed but not designed.
  Worth a separate template.
- **Onboarding steps 1, 2, 4.** Only step 3 is in the prototype.
  Worth filling in: step 1 (create-account / org-name), step 2
  (upload first doc), step 4 (invite first colleague).

Things to keep:

- The amber-only AI contract. Don't dilute by sprinkling amber
  into chrome.
- Editorial serif for narrative; mono for data; Inter for chrome.
- Sense-check badge variants — they're already battle-shaped and
  consistent across surfaces.
- The "ink on paper" calmness. The product handles legally
  sensitive material; the visual register should feel like a
  ledger, not a dashboard.

## 7. Provenance

This brief was distilled by reading the prototype's six HTML files,
its 1553-line stylesheet, and its small interaction shim, then
condensing the design intent. The prototype is local-only on
`proto/v1-mvp-design` and will not be pushed to remote — it exists
as a one-shot generator for this brief. Future iteration happens
against this brief, not against the static HTML.

**Change log.**

- 2026-05-27 — Initial brief authored from prototype. Three design
  questions in the prototype commit body answered in §2. Awaiting
  Bradley's read.
