# Design — ai-data-room / admin-dashboard

**Status:** draft
**Requirements:** [./requirements.md](./requirements.md)
**Last updated:** 2026-04-21
**Depends on:** all prior slices (1–6, 8)

## Summary

Pure-UI slice in the existing Vite SPA `web` package. Nine route
entries under `/dashboard/*` composed from data-layer helpers that
call **aggregate** endpoints added to earlier slices where NFR3
demands it (≤3 calls per page). Shared primitives
(`DataTable`, `Filters`, `InlineActions`, `StatPill`, `ActivityRow`)
live in `packages/web/src/components/dashboard/`. No new backend
capability beyond thin **aggregate** BFF endpoints that compose
existing APIs and a CSV exporter for the audit log. Role gating is
applied at the route layout level; internal users get a read-only
variant driven by a single `canWrite(target, capability)` helper.

## Architecture

```mermaid
flowchart LR
  Web[Vite SPA web<br/>/dashboard/*]

  subgraph BFF["BFF aggregates (microservices/core)"]
    HomeAgg[/dashboard/home]
    AuditExport[/audit/export.csv]
    QnaActivityAgg[/qna/activity?expanded=...]
  end

  subgraph Slices["Existing slice APIs"]
    Auth[auth-and-orgs]
    Room[room-and-folders]
    Access[access-control]
    Checklist[doc-checklist]
    Sense[ai-doc-sensecheck]
    Qna[ai-search-qna]
    Billing[billing-subscription]
  end

  Web --> HomeAgg
  Web --> AuditExport
  Web --> QnaActivityAgg
  Web --> Auth
  Web --> Room
  Web --> Access
  Web --> Checklist
  Web --> Sense
  Web --> Qna
  Web --> Billing

  HomeAgg --> Checklist
  HomeAgg --> Access
  HomeAgg --> Sense
  HomeAgg --> Auth
```

## Page inventory

| Route                            | Purpose                            | Consumes                          | NFR3 budget |
| -------------------------------- | ---------------------------------- | --------------------------------- | ----------- |
| `/dashboard`                     | Home widgets (FR1)                 | `GET /dashboard/home`             | 1 call      |
| `/dashboard/users`               | Users + memberships + grants (FR3) | `GET /users`, `GET /grants`       | 2 calls     |
| `/dashboard/invitations`         | Invites (FR5)                      | `GET /invitations`                | 1 call      |
| `/dashboard/grants`              | External grants (FR7)              | `GET /grants?groupBy=opportunity` | 1 call      |
| `/dashboard/review`              | Sensecheck queue (FR10)            | `GET /ai-decisions/queue`         | 1 call      |
| `/dashboard/qna-activity`        | Q&A activity (FR12)                | `GET /qna/activity`               | 1 call      |
| `/dashboard/audit`               | Audit log (FR14)                   | `GET /audit/events?filters`       | 1 call      |
| `/dashboard/settings`            | Settings tabs (FR16)               | Multiple — tab-scoped, lazy       | ≤3 per tab  |
| `/dashboard/settings/nda`        | NDA version editor                 | `GET /nda/templates`              | 1 call      |
| `/dashboard/settings/checklists` | Templates                          | `GET /templates`                  | 1 call      |
| `/dashboard/settings/sensecheck` | AI toggle                          | `GET /settings/sensecheck`        | 1 call      |
| `/dashboard/settings/billing`    | Billing                            | embed from slice 8                | 0 new calls |

## New BFF endpoints

### `GET /orgs/:orgId/dashboard/home`

Aggregates the five home-page widgets in one call (FR1, FR2, NFR3).

```json
{
  "completionByFolder": [
    {
      "folder": "01_Company_Overview",
      "percent": 85,
      "required": 12,
      "approved": 10
    }
  ],
  "roomCompletionPercent": 72,
  "activeGrantsCount": 14,
  "grantsExpiringSoonCount": 3,
  "reviewQueueCount": 6,
  "recentActivity": [
    {
      "id": "...",
      "at": "...",
      "summary": "Alice approved slot 'Latest audited accounts'"
    }
  ]
}
```

Implemented in `microservices/core/application/dashboard/home.ts`.
Runs 3 queries in parallel + in-memory compose. Cached 30s per
`orgId` via LRU.

### `GET /orgs/:orgId/audit/export.csv`

Returns a streamed CSV of filtered audit events honouring the same
query params as the UI. `Content-Type: text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="audit-<org>-<from>-<to>.csv"`.
Row format matches the columns shown in the UI (FR14, AC-US8).
Pagination swapped for `cursor` + server-side loop; backpressure
via chunked transfer.

### `GET /orgs/:orgId/qna/activity` (existing — add `expand` param)

Adds `?turnId=<id>` variant returning the cited passages inline
per FR13. Gated by admin's own document access.

## Component library

Files under `packages/web/components/dashboard/`:

| Component          | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `DataTable<T>`     | Sortable, filterable, paginated table with slot API for cells.   |
| `Filters`          | Declarative filter panel (select / multi-select / date / range). |
| `InlineActions<T>` | Dropdown of row-level actions gated by `canWrite`.               |
| `StatPill`         | Small coloured pill for numbers (e.g. "3 expiring").             |
| `ActivityRow`      | Renders an audit event in human-readable form (FR15).            |
| `LifecycleBadge`   | User state badge.                                                |
| `VerdictBadge`     | Traffic-light pill for AI verdicts.                              |
| `EmptyState`       | Consistent empty-state renderer.                                 |

All components ship Storybook stories + a11y snapshots.

## Role gating

Single helper `useCanWrite()` hook wraps a cached call to
`access-control`'s `capabilities.json` endpoint (a new lightweight
endpoint that returns the user's capabilities map for a given
scope — added as part of this slice's BFF work). `InlineActions`
filters its menu by this helper. Server still enforces
authorisation; the UI just avoids dead-looking buttons.

### Internal-user variant (FR17)

Routes render the same pages; action affordances are hidden or
disabled. A single layout-level banner makes the read-only mode
explicit.

## Data-loading pattern

- Routes are React Router entries; data is loaded via React Router
  `loader` callbacks on route entry, falling back to TanStack
  Query / SWR-style client hooks (`useDashboardHome`) where
  polling-on-focus matters (home + review + activity).
- Mutations call the BFF endpoints directly via the Eden Treaty
  client (the same client every other page uses), keeping
  data-layer logic colocated with the route component.
- The SPA renders fully client-side; SSR is not in scope for v0.1.

## Performance budget

- Home p95 ≤1s (NFR2 home). Measured in integration test with
  seeded org fixture (200 users, 50 grants, 30 slots, 20 activity
  events).
- Client bundle ≤200KB gzipped on dashboard route (NFR6).
  Enforced via `vite-bundle-visualizer` (or
  `rollup-plugin-visualizer`) CI check.
- No list view issues >3 API calls on first render (NFR3). ESLint
  rule: `max-api-calls-per-page` (custom).

## Accessibility (NFR1)

- All pages keyboard-navigable, including table row actions.
- Focus management on modal open/close.
- Colour contrast ≥4.5:1 (Tailwind preset tweaked if needed).
- Skip-to-main link.
- Axe-core scan in Playwright CI on every dashboard route.

## Responsive (NFR2)

- Mobile breakpoint 375px tested. Tables switch to stacked-card
  rendering below 768px.
- NDA editor and checklist-template editor labelled best-effort on
  mobile; show "best on desktop" banner.

## Observability

**Client metrics** (via `@axiom-fe` or equivalent):

- `dashboard.home.load_ms` — histogram.
- `dashboard.page.error_rate{page}` — ratio.
- `dashboard.route.first_contentful_paint_ms` — histogram.

**Server metrics:**

- `bff.dashboard.home.latency_ms` — histogram.
- `bff.audit.export.rows` — histogram.

## Key trade-offs

- **BFF aggregates vs. GraphQL** — aggregates are narrow and
  hand-rolled (3 endpoints). GraphQL overhead (schema, resolvers,
  security review) isn't worth it for this surface area.

- **Vite SPA rather than an SSR framework** — the original draft
  scoped server components and server actions. Reality: the
  monorepo's `packages/web` is a Vite + React Router 7 SPA, every
  authenticated request goes through API Gateway anyway, and SEO
  doesn't matter for a logged-in admin surface. Sticking with the
  SPA keeps the build simple, the deploy story (CloudFront + S3)
  unchanged, and avoids re-litigating hosting. Read-mostly pages
  use route-level `loader` data fetches; interactive parts
  (filters, inline actions) use TanStack Query / SWR-style hooks.

- **Source-of-truth linking (NFR4) vs. duplicated rendering** —
  e.g. clicking a queued document opens the existing
  `room-and-folders` doc detail page rather than re-rendering it
  in the dashboard. Keeps code + tests DRY.

- **One settings page vs. split pages** — tabbed page for the four
  settings sections (NDA / Checklist / Sensecheck / Billing). Each
  tab is a route so deep-linking works (`/dashboard/settings/nda`).

## Security

- Every route behind the admin-or-internal role gate from
  `access-control`. External users redirected to their
  Opportunity URL.
- BFF endpoints behind `requires(...)`; same rules as wrapped
  slice endpoints.
- CSV export enforces per-row authorisation during streaming —
  no row exits if the admin can't read it (property test in
  T-013).
- No slice-crossing inference: dashboard never derives auth state
  from other data — always calls `access-control` or reads
  session.

## Rollout

Behind feature flag `dashboard_v2` per-org. Default ON at launch.
No data migrations; all changes UI + BFF endpoints. Can ship
incrementally (home first, then users, etc.).

## Open questions

- **Live updates** — polling on focus at v0.1, SSE in Phase 2.
- **Favourites / pins** — punt.
- **Excel export** — CSV only at v0.1.
- **Multi-org switcher** — out of scope v0.1.

## Sign-off

- [ ] Bradley reviewed
- [ ] Tasks phase unblocked
