# datum/room — Build Brief & Prototype Handoff

> A clickable, high-fidelity prototype of an **AI-native secure data room** for fintech
> deals. This brief points an engineering/design agent at the prototype and explains
> what to build, what's real, and what's mocked. Open **`Cited Q&A.html`** first.

---

## 1. What this is

A secure data room where a host company (here: **Capital Pay**) shares a curated set of
documents with external parties (vendors, investors) under NDA, and an AI assistant
answers questions **grounded only in documents the viewer is allowed to see**, citing
every claim. The product's whole identity is *trustworthy, auditable AI*.

The prototype is **6 linked HTML screens** sharing one design system and one
role-based-access model. It is a faithful UX/visual spec — not production code. Treat the
markup, tokens, copy, states, and interaction model as the source of truth; re-implement
on your real stack.

### Screens (each is a standalone `.html` you can open)
| File | Screen | Purpose |
|---|---|---|
| `Cited Q&A.html` | **Ask the room** | Hero. Grounded answers, citation→source highlight, honest "no answer" state, scoped per viewer. |
| `Folder View.html` | **Folder (02_Financials)** | Required-docs checklist, AI sense-check, doc table, audit panel, **upload flow**. |
| `Opportunity.html` | **Subroom (Stripe Inc.)** | Scoped subroom admin: folder grant/deny, viewers + NDA, mobile external-viewer mock. |
| `Audit Log.html` | **Audit log** | Tamper-evident trail, AI + human events, filters. |
| `Members.html` | **Members & access** | Internal team + external viewers, **invite wizard**, revoke/suspend. |
| `Design System.html` | **Design system** | Living spec: tokens, type, status palette, AI-colour contract, components. |

---

## 2. The one rule that defines the product

**A single reserved colour means "this came from the AI" — and nothing else uses it.**
Citations, sense-check flags, AI suggestions, AI audit entries, the diamond mark, the
composer accent: all use the `--ai-*` token group. Chrome and the muted status palette
(ok/warn/err/pending) **never** touch it. This contract must survive into production.

The reserved hue is **swappable** as one attribute on `<html data-ai="…">`:
`indigo` (default, "Signal Indigo"), `amber` ("Ledger Amber"), `teal` ("Archive Teal").
Default ship state is **Signal Indigo + compact density**.

---

## 3. Design system — `tokens.css` is the single source of truth

- **Surfaces:** warm "ink on paper" neutrals (`--paper`, `--paper-2/3`, `--card`). No pure
  black/white, no gradients, no glow. Two shadow layers only.
- **Ink:** `--ink`, `--ink-2`, `--ink-3` (warm greys).
- **Status (muted, never AI):** `--ok` forest, `--warn` ochre, `--err` oxblood, `--pending` grey, each with a `-tint`.
- **AI surface (reserved):** `--ai`, `--ai-strong` (AA text), `--ai-soft` (borders), `--ai-tint`/`-tint-2`, `--ai-on`.
- **Type:** Source Serif 4 (titles + all Q&A prose) / IBM Plex Sans (chrome) / IBM Plex Mono (data, counts, IDs — tabular numerals).
- **Radii:** 3/5/8px + pill. See `Design System.html` for the full swatch sheet and component library (buttons, badges, audit verbs, progress, AI callout).

Shared chrome lives in `shell.css` + `shell.jsx` (Sidebar, TopBar, badges, icons, the
"view as" switcher, preview bar, NDA gate). Screen-specific CSS: `room.css`, `folder.css`,
`opp.css`, `audit.css`, `members.css`, `access.css` (modals/wizard/upload), `ds.css`.

---

## 4. Role-based access — `identity.js` is the model

`window.Datum` is the single RBAC source of truth. Mirror this on the server.

**Roles & capabilities** (`ROLES`):
- **Owner** — everything: manage access, upload, download, audit, members, AI admin, subrooms.
- **Editor** — full room, upload, audit, AI admin; **cannot** manage access/members.
- **Viewer (internal)** — full room, download, audit; no upload, no manage.
- **External viewer** — **scoped** folders only, NDA-gated, per-user `download`/`watermark`/`expires`; no audit, no members, no AI-admin surfaces.

**Per-viewer fields:** `scope` (folder idxs), `nda` (signed/pending), `download`, `watermark`, `expires`, `org`, `subroom`.

**Enforcement the prototype demonstrates (must be real + server-side in prod):**
1. **Scope is absolute** — out-of-scope folders are invisible: not listed, not searchable, not citable, not requestable. Opening one → denied wall.
2. **NDA gate** — an unsigned external viewer sees only a "sign the NDA" screen; no document is reachable.
3. **Page guards** — external viewers are redirected from owner/admin pages (Audit, Members, Opportunity).
4. **Scoped AI** — "Ask the room" only searches/cites the viewer's folders; document count + sources reflect scope.
5. **Watermark + view-only** — honoured per viewer; every view/download is logged.

**"Viewing as"** — the top-right switcher lets the owner preview the room as any identity
(persisted in `localStorage['datum.viewerId']`; page reloads on switch, redirecting if the
target can't see the current page). This is a **preview tool for the owner**; in prod it
maps to genuine per-session auth — the *rendered result* per identity is the spec.

---

## 5. Two flows to build for real

### Upload flow (`upload-flow.jsx`, on Folder View)
Owner/editor only. Drag-drop or file-picker (samples provided for demo) →
**AI reads & classifies** → checks against the folder's required-documents checklist →
- **Match:** shows classification + confidence, the mandatory/optional item it satisfies, and the updated checklist (the item ticks, progress climbs).
- **Misfile:** flags it, names the correct folder, offers "Move to …" vs "Add here anyway".
Every upload + classification + move writes to the audit log.
Per-folder checklists live in `Datum.CHECKLISTS` (mandatory vs optional, present vs missing).

### Grant / revoke (`access-components.jsx`, on Members)
- **Invite wizard** — Person (email + role) → Scope (folders; skipped for internal roles) → Limits (NDA, downloads, watermark, expiry) → Review & send.
- **Row menu** — change role, edit scope, suspend, **revoke** (destructive → confirm dialog). All logged.

---

## 6. What's mocked (replace with real services)
- **AI** — answers, citations, confidence, classification, sense-check, and the upload
  analysis are scripted/timed. Wire to your retrieval + model. Keep the *grounding +
  citation* contract and the honest "no grounded answer" state.
- **Data** — documents, members, viewers, audit events, runway figures are fixtures.
- **Files** — upload takes a filename; no real storage/indexing. Add encryption-at-rest,
  virus scan, real indexing.
- **Auth** — identity switching is a `localStorage` preview. Replace with real auth/SSO,
  server-enforced scope, signed NDAs, and a genuinely append-only/hash-chained audit log
  (the "tamper-evident" strip is currently decorative).
- **Watermarking** — indicated in UI only; implement per-page identity stamping.

## 7. Tech notes
- Prototype is React 18 + Babel-in-browser (pinned), plain-JS `identity.js`, component CSS.
  Fine for a prototype; for prod, build properly (no in-browser Babel).
- Tweaks panel (toolbar) exposes the AI-colour contract + density live — useful for
  picking the final reserved hue with stakeholders.
- Email domains use `capitalpay.co.uk` (internal) / external orgs as sample data.

## 8. Suggested build order
1. Tokens + shell + RBAC model (server-enforced scope is the foundation — do not skip).
2. Folder view + real upload/index pipeline + per-folder checklists.
3. Ask-the-room with scoped retrieval + citations + "no grounded answer".
4. Members + invite/revoke + subrooms.
5. Tamper-evident audit log.
6. External viewer experience (NDA, watermark, view-only) end-to-end.
