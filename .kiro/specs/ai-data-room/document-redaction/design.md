# Design — ai-data-room / document-redaction

**Status:** draft
**Requirements:** [./requirements.md](./requirements.md)
**Last updated:** 2026-05-31
**Depends on:** `room-and-folders`, `access-control`, `tenant-isolation`;
soft-depends on `ai-doc-sensecheck` (shared extractor)

## Summary

Redaction is modelled as an editable **region set** plus an irreversibly
**flattened rendition**. Manual regions are the MVP path; an async worker
optionally produces **AI-suggested** regions (Claude over the shared extractor)
that a human must confirm. The download path in `access-control` is taught to
serve the rendition — never the original — to redaction-scoped viewers. The
load-bearing invariant is that the rendition contains no recoverable trace of
redacted content; this is produced by burning regions into a rasterised/
flattened PDF, not by overlaying boxes.

## Architecture

```mermaid
flowchart LR
  Admin[Owner/Admin] --> RegionAPI[POST /documents/:id/redactions]
  RegionAPI --> PG[(redactions:<br/>regions JSONB)]
  Admin --> Publish[POST /documents/:id/redactions/publish]
  Publish --> Queue[SQS redaction-render]
  Queue --> Worker[Lambda render-worker]
  Worker --> S3o[(S3 original)]
  Worker --> Flatten[Flatten/raster pipeline<br/>burn regions → new PDF]
  Flatten --> S3r[(S3 rendition)]
  Worker --> PG2[(document_renditions)]

  subgraph AI assist (optional)
    Suggest[POST /documents/:id/redactions/suggest] --> Q2[SQS redaction-suggest]
    Q2 --> SW[Lambda suggest-worker]
    SW --> Extract[shared extractor<br/>ai-doc-sensecheck]
    Extract --> Claude[Claude Haiku 4.5<br/>PII span detection]
    Claude --> PG
  end

  Viewer[External viewer] --> DL[access-control download]
  DL -->|redaction-scoped| S3r
  DL -->|internal w/ rights| S3o
```

## Data model

### `redactions`

Editable region definitions (the source of truth an admin revises).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `org_id` | `uuid` FK | tenant-scoped (`tenant-isolation`). |
| `document_id` | `uuid` FK | |
| `document_version_id` | `uuid` FK | the version the regions anchor to. |
| `regions` | `jsonb` | `Array<{page, box{x,y,w,h}} | {kind:'text', start, end}>`. |
| `source` | `enum('manual','ai_suggested','ai_confirmed')` | provenance. |
| `status` | `enum('draft','published','superseded')` | |
| `created_by` / `updated_by` | `uuid` FK `users.id` | |
| `created_at` / `updated_at` | `timestamptz` | |

### `document_renditions`

The flattened, externally-served artifact.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `org_id` | `uuid` FK | tenant-scoped. |
| `document_id` | `uuid` FK | |
| `redaction_id` | `uuid` FK `redactions.id` | which region set produced it. |
| `s3_key` | `text` | private; served only via pre-signed URL. |
| `kind` | `enum('redacted')` | reserved for future rendition kinds. |
| `status` | `enum('current','superseded')` | |
| `sha256` | `text` | integrity. |
| `created_at` | `timestamptz` | |

Index: `(document_id, status)` — fast "current rendition for doc" lookup.

## Flatten pipeline (NFR1 — the security core)

The rendition must contain **no recoverable original content**. Approach at
v0.1:

1. Load the original (DOCX/XLSX rendered to PDF first — see open question).
2. For each redaction region, **remove** the underlying content objects in the
   region (text runs, image fragments), then **rasterise the affected page(s)**
   so no text layer or vector remnant survives, and paint the region solid.
3. Re-assemble a new PDF with no document metadata carried over from the
   original beyond what's needed.
4. Verify: run the rendition back through the extractor (the same one
   `ai-doc-sensecheck` uses) and assert no redacted span text is present and no
   image data exists under any region (AC-US2). A rendition that fails
   verification is not published.

This "remove-then-rasterise-then-verify" loop is deliberately conservative —
overlaying a black box (the classic redaction bug) is explicitly forbidden.

## AI suggestion flow

- `POST /documents/:id/redactions/suggest` enqueues a job.
- Worker extracts text per page (shared extractor), sends it to **Claude Haiku
  4.5** with a versioned prompt (`redaction-suggest-v1`, stored in code like
  `ai-search-qna`'s prompts) asking for likely-sensitive spans with anchors.
- Document text is framed as **untrusted** (prompt-injection-safe, per
  `ai-search-qna` §Security).
- Results are written as `redactions` rows with `source='ai_suggested'`,
  `status='draft'` — **never** published automatically (FR6).
- The admin confirms (→ `ai_confirmed`), edits, or dismisses. Fail-safe: any
  worker error yields zero suggestions, never a block or a false rendition.

## Interfaces

All under `/orgs/:orgId/documents/:documentId/redactions`, owner/admin only
(except none are exposed to external roles).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/redactions` | Current region set + rendition status. |
| `POST` | `/redactions` | Create/replace draft regions (manual). |
| `POST` | `/redactions/suggest` | Enqueue AI suggestion job. |
| `POST` | `/redactions/publish` | Flatten + publish a rendition. |
| `DELETE` | `/redactions/:regionId` | Drop a region. |

Download stays owned by `access-control`; this slice provides
`resolveServedObject(doc, grant)` → original vs. current rendition (FR8/FR9).

## Security

- **No original to redaction-scoped viewers (FR4/FR8):** the download resolver
  returns the rendition `s3_key` for redaction-scoped grants; there is no code
  path that hands such a viewer the original key. Enforced + unit-tested.
- **No recoverable content (NFR1):** the verify step in the flatten pipeline
  is mandatory and gates publication.
- **Block-on-no-rendition (FR9):** sharing a redaction-scoped doc with no
  current rendition is refused.
- **Tenant isolation:** `redactions` + `document_renditions` are tenant-scoped
  and flow through the `tenant-isolation` factory.
- **Prompt injection:** suggestion prompt treats text as untrusted.

## Observability

- **Metrics:** `redaction.renditions_published`, `redaction.render_latency_ms`
  (histogram), `redaction.verify_failures` (count — should be ~0),
  `redaction.ai_suggestions{accepted,dismissed}`.
- **Alert:** `redaction.verify_failures > 0` → investigate (a pipeline bug
  here is a potential leak).
- **Logs:** `documentId, redactionId, regionCount, source, latencyMs`.

## Key trade-offs

- **Render-to-PDF for Office formats (chosen v0.1).** The external artifact is
  a fixed rendition anyway; native-format redaction is harder and riskier.
- **Remove-then-rasterise over vector-only removal.** Belt-and-braces against
  text-layer remnants — the historically common redaction failure. Slightly
  larger output; acceptable.
- **Human-in-the-loop AI (never auto-apply).** Recall isn't perfect and a
  missed PII is the admin's call to catch; auto-applying would create false
  confidence. Matches the product's "AI assists, human decides" stance.
- **Haiku 4.5 for suggestions.** Cheap + fast; gated by a recall eval. Escalate
  to Sonnet if recall is poor.

## Eval harness (minimal v0.1)

`bun run eval:redaction` parallel to the sense-check/qna evals: a golden set of
documents with known sensitive spans; measures suggestion recall (did we
propose the spans that matter?) and false-positive rate. Snapshot committed; CI
runs on prompt or pipeline changes.

## Open questions

- Rendition storage: dedicated `document_renditions` table (chosen above) vs.
  reusing `document_versions` with a discriminator — confirm in T-001.
- Should manual redaction support text-range anchors for native PDFs with a
  text layer, or box-only at v0.1? Leaning box-only first (simpler, format-
  agnostic), text-range as a fast follow.
- Do we need redaction on the canonical room (internal) or only on
  Opportunity-shared docs? Leaning: allow anywhere, enforce on external serve.

## Sign-off

- [ ] Bradley reviewed
- [ ] Tasks phase unblocked
