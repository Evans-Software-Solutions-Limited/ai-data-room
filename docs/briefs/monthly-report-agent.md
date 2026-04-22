# Brief: monthly-report-agent — Capital Pay monthly MD report automation

> One page. If it's longer than one page, it's a spec, not a brief.

**Type:** internal-automation
**Status:** brief (pending Bradley sign-off before spec phase)
**Owner:** Bradley
**Created:** 2026-04-22
**Last updated:** 2026-04-22

## Problem
The Capital Pay division's monthly **MD Report** (internal + external
versions) is produced on a grind: on deadline week, Bradley + Kurtis pull
context from memory, DM contributors piecemeal, and hand-assemble an 8-page
narrative PDF. Current AI tooling generates a skeleton template but still
requires typing answers to every section question in one sitting, from
month-long recall. The process is late-binding, error-prone (typos through
to the signed-off version — _Rhadika_, _Dontae_), and eats a day+ of
leadership time every month.

## User / audience
- **Primary:** Bradley (Product & Engineering owner + report coordinator),
  Kurtis (MD voice — Overview / Focus Areas / Looking Ahead).
- **Secondary contributors:** Radhika (HR + Ops), Ryan (Commercial — new),
  Dontae (project-gated, e.g. Cyber Essentials).
- **Downstream readers:** Capital Pay group (Mauritius HQ, UK, Kenya),
  founders + CSO (internal); prospective partners + stakeholders
  (external).

## Hypothesis
If we replace monthly recall with a **rolling weekly Slack capture loop
feeding a pre-drafted Notion page by the 23rd**, then the MD report cycle
compresses from ~a full day of leadership effort to an editing pass of a
couple of hours, because the cognitive load of "remember a month" goes
away and the narrative is already drafted in-voice before anyone sits
down to write it.

## Value
- **Time:** reclaim ~1 leadership day per month, recurring.
- **Quality:** consistent structure, names spelled correctly, tone
  steady across months; stops typos landing in exec-visible documents.
- **Behaviour:** weekly capture surfaces early-warning signals (blockers,
  risks, slipping milestones) that currently only emerge at month-end.
- **Reusability:** once built on SST, the same pattern is reusable for
  other divisions in the Capital Pay group or as a template under
  Evans-Software-Solutions-Limited.

## Success metric
MVP success = **May 25 MD report produced end-to-end by the agent**,
where Bradley + Kurtis's total editing time is under 2 hours combined
(vs. current ~1 full day) and the final document passes a proofread
with zero name/fact errors. Leading indicator: **weekly capture
response rate ≥90%** across mandatory contributors without manual
chasing by Bradley.

April's report goes out **via the existing manual process** — no
agent in the loop. We spend the rest of April + first week of May
standing up the weekly capture loop so captures begin week of May 4
and feed a May 23 synthesis.

## Constraints
- **Time:** v1 steady-state on SST by May 4 so weekly captures start
  that week. Synthesis runs May 23; Bradley + Kurtis edit and sign
  off for May 25 publication.
- **Tech:** TypeScript / SST v4 for steady-state (Bradley's stack,
  for reusability + portability under Evans-Software-Solutions-Limited).
- **Integrations:** Slack (capture surface), Notion (draft + review +
  canonical store), PDF renderer (final output matching CapitalPay
  branded template).
- **Knowledge base:** prior monthly reports (internal, eventually
  external) are ingested at spin-up and auto-appended going forward.
  Used as style exemplars + continuity context + entity knowledge
  during synthesis.
- **Data sensitivity:** contains pre-announcement commercial terms,
  partner names, hiring info, and internal strategy. Storage + access
  follows Capital Pay internal handling — no external data sharing.
- **Human-in-the-loop:** Bradley (and/or Kurtis) signs off every
  publication. Agent never auto-sends to head office.

## Scope (first iteration)

### In
- Weekly Slack capture loop: single private channel, @-mentions per
  contributor, section-scoped questions, replies in threads, auto-chase
  reminders in-thread if silent.
- Prior-reports knowledge base: ingest all historical monthly reports
  at spin-up; auto-append each new published report. Used as style
  exemplars + continuity context during synthesis.
- Monthly synthesis: on the 23rd, agent drafts the **internal** MD
  report into a Notion page, pre-populated with pulled Slack content
  and grounded against the KB, in MD-report voice.
- Notion → PDF export matching the CapitalPay branded template.
- Proofread pass: name-consistency check (Radhika/Dontae/Kurtis
  spellings), grammar, tone-check vs. prior months.

### Out (phase 2+)
- External report generation (awaiting the external March reference
  from Bradley; redaction + reformat pass to be specced separately).
- Finance section / budget-vs-actual tracking — explicitly a separate
  workflow, not part of this agent.
- Bradley's own Product & Engineering section auto-draft from meeting
  transcripts / Fireflies / Jira — separate workstream per Bradley.
- Auto-publish / email distribution to head office — human-in-the-loop
  publishes.
- Cross-region localisation (Mauritius/Kenya-specific variants) —
  Phase 2.

## Open questions
- Which Slack workspace + channel name? (assumed: Capital Pay workspace,
  new private channel `#monthly-report-capture` or similar, Bradley
  owns creation + invites.)
- Notion parent page / teamspace for the report drafts? (assumed:
  Capital Pay Notion, new page tree under a leadership space.)
- Kurtis's template — still awaiting. Will inform the exact question
  set per section. Agent designed to swap question sets without code
  changes.
- External report example — awaiting. Gates the phase-2 redaction
  rules.
- Repo location for SST build: `~/Documents/projects/personal/` under
  Evans-Software-Solutions-Limited, or under the Capital Pay GitHub
  org? (The reusability answer points to ESS; the fintech-consumer
  angle points to Capital Pay.)

## Next step
Brief → **Requirements phase**. Single Kiro-style spec at
`/specs/monthly-report-agent/`. No code until requirements signed off.
April's report goes out manually in parallel; the agent's first live
cycle is May.
