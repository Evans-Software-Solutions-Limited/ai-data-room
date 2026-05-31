# Handoff: datum/room — AI-native secure data room

## Overview
**datum/room** is a secure data room for fintech deals (host company: **Capital Pay**). A
host shares curated documents with external parties (vendors, investors) under NDA, and an
AI assistant answers questions **grounded only in the documents a given viewer is allowed
to see**, citing every claim. The product's identity is *trustworthy, auditable AI*.

This package is a **high-fidelity, clickable prototype** of the full experience: 6 linked
screens, a shared design system, a role-based access model with live "view as" identity
switching, an AI-checked document upload flow, and an invite/revoke access flow.

## About the design files
The files in this bundle are **design references built in HTML/React-via-Babel** — they
show the intended look, copy, states, and interaction model. They are **not production
code to ship**. Your task is to **recreate these designs in the target codebase's
environment**, using its established framework, component library, and patterns. If no
codebase exists yet, choose an appropriate stack (React + a CSS approach that supports
design tokens is a natural fit) and implement there.

Critically: several behaviours are **mocked client-side but must become real and
server-enforced** in production — folder scope, NDA gating, scoped AI retrieval, watermark,
and an append-only audit log. See **§ What's mocked**.

You can open any `.html` file directly in a browser to interact with the prototype. Start
with `Cited Q&A.html`. Use the **top-right identity switcher** to preview the room as
different users (Owner, Editor, internal Viewer, and three external guests).

## Fidelity
**High-fidelity.** Final colours, typography, spacing, copy, and interactions. Recreate the
UI faithfully using the codebase's libraries. Exact tokens are listed below and in
`tokens.css`. The companion **`HANDOFF_BRIEF.md`** in this folder gives the product/system
rationale and a suggested build order — read it alongside this README.

---

## The one rule that defines the product
**A single reserved colour means "this came from the AI" — nothing else uses it.**
Citations, sense-check flags, AI suggestions, AI audit entries, the diamond glyph, the
composer accent: all use the `--ai-*` token group. Chrome and the status palette
(ok/warn/err/pending) **never** use it. Preserve this contract in production.

The reserved hue is swappable via `<html data-ai="indigo|amber|teal">`. **Ship default:
Signal Indigo, compact density.**

---

## Screens / Views

### 1. Ask the room — `Cited Q&A.html`
- **Purpose:** The hero. Ask natural-language questions; get answers grounded in indexed
  documents with inline citations.
- **Layout:** 260px sidebar (grid col 1, full height) · 56px top bar · main area split into
  a chat column (flex) + a 340px source rail (right).
- **Components:**
  - **Exchange:** user prompt (28px avatar + serif question) → AI answer (indigo diamond mark
    + serif prose at 17px/1.62). Bold key figures. **Inline citation chips** (`[1]`,`[2]`…):
    mono 10.5px, `--ai-tint` bg, `--ai-soft` border, `--ai-strong` text; clicking one
    scrolls the matching source card into view and highlights it (active chip = solid
    `--ai`).
  - **Confidence bar:** label + 132px track (`--ai` fill) + mono %; meta "N sources · model".
  - **Answer tools:** Copy / Flag answer / View in audit log (links to `Audit Log.html`).
  - **"No grounded answer" state:** an `--ai-tint` card with a "No grounded answer" badge,
    italic serif statement, and a mono "searched … · N documents · 0 supporting passages"
    line. This honest empty state is a *feature* — keep it.
  - **Source rail cards:** corner index badge, mono folder/file path (folder in `--ai-strong`),
    serif doc title, snippet with a left rule, mono meta. Active card = `--ai` border + ring.
  - **Composer:** serif textarea, indigo diamond, ink send button (disabled until input),
    suggested-question chips, footer note.
- **Per-identity:** external viewers see a scoped welcome (no internal thread), doc count =
  sum of their folders, "set by Capital Pay" locked scope pill, watermark note, empty rail.
  Unsigned external → **NDA gate** (see shell).

### 2. Folder — `Folder View.html` (02_Financials)
- **Purpose:** Browse a folder; see the required-documents checklist and AI sense-check;
  upload (owner/editor).
- **Layout:** `page-wide` (max 1180px). `folder-grid`: 320px checklist panel + flexible
  docs column.
- **Components:**
  - **Required-documents checklist panel:** big mono count `N / total`, progress bar
    (`--ai` fill when a flag is open, else `--ink`), rows with present (`--ok` check) /
    missing (dashed circle) states and required/optional mono tags.
  - **AI sense-check callout** (`.ai-callout`, reserved surface, 2-stroke corner mark):
    flags `Marketing_Deck_2025.pdf` as a 04_Product doc misfiled in Financials; actions
    "Move to 04_Product" / "Keep here".
  - **Documents table** (`.dtable`, `table-layout: fixed`, colgroup widths
    30/20/14/11/17/8%): file (mono filename, ellipsis) · AI classification + confidence ·
    uploader · added · sense-check badge (Match/Move suggested/Checking) · row menu.
  - **Recent activity** panel (mini audit list, links to full log).
  - **Upload button** (owner/editor only) → upload flow modal (see § Flows).
- **Per-identity:** internal viewer → no upload, no AI callout. External in-scope → read-only
  list (no AI metadata columns), watermark banner, view-only or download per grant. External
  out-of-scope → **denied wall** ("02_Financials isn't in your scope" + their openable
  folders). Unsigned external → NDA gate.

### 3. Subroom — `Opportunity.html` (Stripe Inc.)
- **Purpose:** Owner/editor admin of a scoped external subroom.
- **Layout:** `page-wide`; left column + a right panel holding an **iOS device mock**
  (`ios-frame.jsx`) showing the external viewer's mobile experience.
- **Components:** AI access-suggestion callout; **Folder scope** card (Granted with `--ok`
  checks + doc counts / Denied with lock icons + "hidden") and a reassurance line ("cannot
  see, search, or query"); **External viewers** table (NDA badges, last seen, downloads);
  **mobile mock** showing either the post-NDA read-only room or the pre-NDA sign-gate.
- **States** (Tweak): Active subroom / Awaiting viewers / Loading.
- **Guard:** external viewers are redirected away (owner/editor only).

### 4. Audit log — `Audit Log.html`
- **Purpose:** Tamper-evident record of every action, human and AI.
- **Layout:** `page-wide`, single column.
- **Components:** **Integrity strip** (`--ok` shield, "hash-chained · last verified", sha256
  chip — *system trust, NOT AI, so it is green not indigo*); **filter chips** (All / AI
  actions / Access & NDA / Downloads / Uploads — active = ink fill, AI filter = indigo
  fill); events grouped by day. Each **log row** (grid 70/128/1fr/150px): mono time · verb
  badge (AI verbs use `.verb-ai` indigo) · actor avatar (AI = indigo diamond, external =
  dashed) + detail text · right-aligned actor + IP/context. AI rows get a faint `--ai-tint`
  row background.
- **Guard:** internal only; external redirected.

### 5. Members & access — `Members.html`
- **Purpose:** Manage who can reach the room and how.
- **Layout:** `page-wide`. Stat strip (4 cards; the "AI access suggestion" card uses the
  `--ai` surface) · AI access-request callout · Internal team table · one panel per subroom
  of external viewers.
- **Components:** role pills (Owner = ink fill, Editor = grey, Viewer = outline); 2FA status
  (`--ok` / muted); NDA badges; **row action menu** (`.menu-pop`) with change role / edit
  scope / suspend / **revoke** (revoke → confirm dialog → "Revoked" badge + toast);
  **Invite** buttons → **invite wizard** (see § Flows).
- **Guard:** owner only; everyone else redirected.

### 6. Design system — `Design System.html`
- A living spec sheet: principles, surfaces & ink swatches, status palette, the three AI
  colour contracts side by side, the type scale, radii/elevation, and the component library
  (buttons, badges, audit verbs, progress, AI callout). Use it as the visual reference.

### Shell (shared, `shell.jsx` + `shell.css`)
- **Sidebar:** brand wordmark, folder list (internal: all 6 with counts + status dots;
  external: "Shared with you" + scoped folders + a read-only access note), Opportunities
  (owner/editor), Workspace links (gated), active state highlight.
- **Top bar:** breadcrumbs, org pill (role for internal, "guest" for external), and the
  **"View as" switcher** (lists all identities grouped Internal/External; selecting one sets
  `localStorage['datum.viewerId']` and reloads, redirecting if the target can't see the
  current page).
- **Preview bar:** fixed 38px bar shown when not the owner ("Previewing as … — details" +
  Exit preview). Ink bar for internal, `--ai-strong` for external. Pushes app down.
- **NDA gate:** full-screen card shown to unsigned external viewers ("Sign the NDA to enter").

---

## Interactions & behavior
- **Citation chip → source card:** click highlights the chip (solid `--ai`), smooth-scrolls
  the rail to the matching card and rings it. 0.12s colour transitions.
- **AI colour contract swap:** `document.documentElement.setAttribute('data-ai', hue)` swaps
  only `--ai-*`. Exposed via the Tweaks panel.
- **Identity switch:** persisted in localStorage; reload re-renders the whole shell for that
  identity; forbidden pages redirect to a permitted fallback.
- **Sense-check callout:** "Move"/"Keep" resolves the flag → checklist returns to healthy.
- **Upload flow:** see § Flows — timed AI "analysis" (~4 steps), verdict, checklist update,
  toast, audit entry. (Timers visibly run; in prod, drive from real async.)
- **Invite wizard:** stepper; role selection changes the step set (internal roles skip the
  Scope step); Continue is gated by validation per step; final step sends → success state.
- **Revoke/suspend:** row menu → destructive action → confirm dialog → status badge + toast.
- **Toasts:** fixed bottom-center ink pill with check icon, dismissible.

## State management
Per-screen React state today; map to your store. Key state:
- **Global identity** (`Datum.getViewer()` from localStorage) → drives sidebar, guards,
  scope, gating everywhere. **In prod this is the auth session, server-enforced.**
- **Folder:** screen-state (flagged/healthy/empty/loading), sense-check resolved, uploaded
  docs appended, checklist items satisfied, toast.
- **Members:** invite modal open, confirm dialog target, per-email status overrides
  (suspended/revoked), toast.
- **Upload flow:** phase (pick → analysing → verdict), chosen doc, analysis step index.
- **Q&A:** active citation, draft text.

## Design tokens (exact — see `tokens.css` for oklch source)
**Surfaces:** `--paper` #f7f5f0 · `--paper-2` #efece4 · `--paper-3` #e6e2d6 · `--card` #fffefb
**Ink:** `--ink` #1a1815 · `--ink-2` #4a463d · `--ink-3` #7a7468 · on-dark #f7f5f0-ish
**Rules:** `--rule` #d8d2c1 · `--rule-2` #e7e2d6 · `--rule-strong` ~#cbc4b2
**Status (muted, never AI):** `--ok` #3f6b4a · `--warn` #a86d1a · `--err` #8e2f2a · `--pending` #6c6660 (+ `-tint` variants)
**AI surface (reserved, default = Signal Indigo):** `--ai` ≈oklch(.50 .14 285) · `--ai-strong` (AA on tint) · `--ai-soft` (borders) · `--ai-tint` / `--ai-tint-2` (bg) · `--ai-on` (on solid). Amber (hue ~52) and Teal (hue ~213) variants under `[data-ai="amber|teal"]`.
**Radii:** 3 / 5 / 8 / 999px (`--r-sm`/`--r`/`--r-lg`/`--r-pill`)
**Shadow:** `--shadow-1` (resting), `--shadow-2` (overlays) — two layers only, no glow.
**Type:** Source Serif 4 (titles + Q&A prose) · IBM Plex Sans (chrome) · IBM Plex Mono (data/counts/IDs, tabular numerals `tnum`+`lnum`). Min slide/print sizes don't apply (this is app UI); body chrome ~12.5–13px, answer prose 17px.

## Flows (build for real)
### Upload (`upload-flow.jsx`, Folder)
Owner/editor. Drag-drop/picker (samples for demo) → AI reads & classifies → checks the
folder's checklist (`Datum.CHECKLISTS`, mandatory/optional): **match** shows
classification + confidence + the item it satisfies + the updated checklist (item ticks,
progress climbs); **misfile** flags it, names the right folder, offers "Move to …" vs "Add
here anyway". Logs every action.

### Grant/revoke (`access-components.jsx`, Members)
Invite wizard: Person (email + role) → Scope (folders; skipped for internal) → Limits (NDA,
downloads, watermark, expiry) → Review & send. Row menu: change role / edit scope / suspend
/ revoke (confirm). All logged.

## Roles (mirror server-side — `identity.js` `ROLES`)
- **Owner:** manage access, upload, download, audit, members, AI admin, subrooms.
- **Editor:** full room, upload, audit, AI admin; no manage-access.
- **Viewer (internal):** full room, download, audit; no upload/manage.
- **External:** scoped folders only, NDA-gated, per-user download/watermark/expiry; no audit/members/AI-admin.

## What's mocked (replace with real services)
- **AI** (answers, citations, confidence, classification, sense-check, upload analysis) —
  scripted/timed. Wire to real retrieval + model; keep the grounding+citation contract and
  the honest "no grounded answer" state.
- **Data** (docs, members, viewers, audit, figures) — fixtures.
- **Files** — upload takes a filename only; add storage, encryption-at-rest, virus scan, indexing.
- **Auth** — identity switching is a localStorage preview. Replace with real auth/SSO,
  **server-enforced scope**, signed NDAs, and a genuinely append-only/hash-chained audit log
  (the integrity strip is decorative today).
- **Watermark** — UI indication only; implement per-page identity stamping.

## Assets
No external image assets — all iconography is inline SVG (in `shell.jsx`'s `Ico` set and per
screen). Fonts load from Google Fonts (Source Serif 4, IBM Plex Sans, IBM Plex Mono). The
iOS device frame is `ios-frame.jsx` (a starter component). Replace fonts/frame with your
codebase equivalents as needed.

## Files in this bundle
**Entry HTML (open these):** `Cited Q&A.html` · `Folder View.html` · `Opportunity.html` ·
`Audit Log.html` · `Members.html` · `Design System.html`
**Tokens & shared CSS:** `tokens.css` · `shell.css` · `access.css`
**Screen CSS:** `room.css` · `folder.css` · `opp.css` · `audit.css` · `members.css` · `ds.css`
**RBAC model (read first):** `identity.js`
**Shared JS/JSX:** `shell.jsx` · `access-components.jsx` · `upload-flow.jsx` · `tweaks-panel.jsx` · `ios-frame.jsx`
**Screen apps:** `qna-app.jsx` · `folder-app.jsx` · `opp-app.jsx` · `audit-app.jsx` · `members-app.jsx`
**Companion brief:** `HANDOFF_BRIEF.md` (product rationale + suggested build order)

## Suggested build order
1. Tokens + shell + **server-enforced RBAC** (the foundation — do not skip).
2. Folder view + real upload/index pipeline + per-folder checklists.
3. Ask-the-room with scoped retrieval + citations + "no grounded answer".
4. Members + invite/revoke + subrooms.
5. Tamper-evident audit log.
6. External viewer experience (NDA, watermark, view-only) end to end.
