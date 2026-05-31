# Requirements — ai-data-room / data-export

**Status:** draft
**Owner:** Bradley
**Last updated:** 2026-05-31
**Brief:** [../../../briefs/ai-data-room.md](../../../briefs/ai-data-room.md)
**Slice index:** [../README.md](../README.md)
**Depends on:** `auth-and-orgs`, `room-and-folders`; relates to `access-control`
(audit log) and `billing-subscription` (offboarding trigger)

## Context

`room-and-folders` NFR7 requires that a single org's data can be exported or
purged without touching others', and `auth-and-orgs` already ships GDPR
hard-delete — but no feature actually produces a **customer-facing export**.
Two needs go unmet: data **portability** (a customer wants their documents +
metadata out, e.g. for GDPR DSAR or simply to leave) and clean **offboarding**
(when a subscription ends, the customer gets their data and the org is purged on
schedule). This slice owns the export bundle and the offboarding lifecycle.

## Users & roles

- **Primary:** owner (or admin with permission) exporting their org's data.
- **Secondary:** support/ops executing an offboarding on cancellation.
- **Roles (from `auth-and-orgs`):** only `owner` (and optionally `admin`) may
  request a full-org export; external users never can.

## User stories

- **US1** — _As an owner, I want to export my entire room — documents plus their
  metadata, checklist state, and audit log — as a single downloadable bundle._
- **US2** — _As an owner leaving the product, I want a complete copy of my data
  before my org is deleted._
- **US3** — _As a compliance owner, I want to fulfil a data-portability request
  with a machine-readable export of the relevant records._
- **US4** — _As ops, when a subscription is cancelled, I want a defined
  offboarding flow: export made available, grace period, then scheduled purge._
- **US5** — _As an owner, I want every export recorded in the audit log so there
  is a trail of who exported what, when._

## Functional requirements

### Export bundle

- **FR1** — An owner shall be able to request a **full-org export**: all current
  document versions (original bytes), plus a machine-readable manifest of
  metadata (folders, opportunities, document attributes, checklist state,
  membership, and the audit log) in JSON + CSV.
- **FR2** — Export shall run async; the requester is notified (via
  `notifications`) when the bundle is ready, and downloads it via a short-TTL
  pre-signed URL.
- **FR3** — The bundle shall be a single archive (e.g. zip) laid out to mirror
  the canonical folder structure so it's human-navigable, with the manifest at
  the root.
- **FR4** — Export scope options: full org, a single Opportunity, or a single
  canonical folder (for partial / DSAR-style requests).
- **FR5** — Exports shall respect document state: current versions by default;
  an option to include version history; soft-deleted/hard-deleted content
  excluded.

### Offboarding lifecycle

- **FR6** — On subscription cancellation (event from `billing-subscription`),
  the org shall enter an **offboarding** state: read-only, a final export made
  available, and a **grace period** (default 30 days) before scheduled purge.
- **FR7** — Purge shall reuse the `auth-and-orgs` GDPR hard-delete machinery and
  shall remove all of the org's data (documents, renditions, renders, passages,
  fts, notifications, etc.) — verifiably, across every tenant-scoped table.
- **FR8** — Offboarding shall be reversible during the grace period
  (reactivation restores the org to active).

### Audit

- **FR9** — Export requested, export ready, export downloaded, offboarding
  started, purge scheduled, purge completed shall all emit audit events.

## Non-functional requirements

- **NFR1** — A full-org export of ≤10GB shall complete in ≤30min p95 (async,
  notified).
- **NFR2** — Export bundles shall be tenant-scoped, encrypted at rest, and the
  download URL short-TTL + single-org-scoped (`tenant-isolation`).
- **NFR3** — Export bundles themselves shall be purged after a retention window
  (default 7 days) so exported copies don't accumulate sensitive data.
- **NFR4** — Purge (FR7) shall be **complete and verifiable**: a post-purge
  check shall confirm zero residual rows for the org across the tenant-scoped
  table registry.
- **NFR5** — The manifest schema shall be versioned so consumers can rely on it.

## Acceptance criteria

- **AC-US1** — An owner requests a full export; when ready, the bundle contains
  the documents in canonical folder layout plus a versioned JSON+CSV manifest of
  metadata, checklist state, memberships, and audit log.
- **AC-US2** — A scoped export of one Opportunity contains only that
  Opportunity's documents + metadata.
- **AC-US3** — Cancelling a subscription puts the org read-only, makes a final
  export available, and schedules purge after the grace period.
- **AC-US4** — After purge, a verification check finds zero residual rows for
  the org across every tenant-scoped table.
- **AC-US5** — Reactivating during the grace period restores the org to active
  with data intact.
- **AC-US6** — Every export + offboarding step appears in the audit log.

## Non-goals (for this slice)

- Continuous backup / sync to customer storage (OneDrive/GDrive) → Phase 2
  (`storage-sync`).
- Per-user (as opposed to per-org) data subject export beyond the existing
  `auth-and-orgs` user delete → Phase 2 if needed.
- Selective field-level redaction within an export → out of scope.
- Self-serve immediate hard-delete without grace period → support-only.

## Open questions

- Bundle format: zip vs. tar.gz — leaning zip (universally openable).
- Should the manifest be one big JSON or per-entity files (documents.json,
  audit.csv, …)? Leaning per-entity files + a top-level `manifest.json` index.
- Grace period length (30 vs. 60 days) and whether it's plan-dependent — confirm
  with `billing-subscription`.

## Sign-off

- [ ] Bradley reviewed
- [ ] Design phase unblocked
