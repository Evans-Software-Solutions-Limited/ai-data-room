# /adr — Architecture Decision Records

One file per non-trivial, hard-to-reverse decision. Numbered, dated, immutable
(supersede rather than edit).

- **Template:** `_TEMPLATE.md`
- **Naming:** `NNN-kebab-case-title.md` (e.g., `001-saas-infra-sst-v4.md`)
- **Lifecycle:** `proposed` → `accepted` → `superseded` (by ADR-XYZ).

## Index

| #                                        | Title                                                        | Status   | Date       |
| ---------------------------------------- | ------------------------------------------------------------ | -------- | ---------- |
| [001](./001-workos-as-auth-platform.md)  | WorkOS as the auth platform for ai-data-room                 | accepted | 2026-04-22 |
| [002](./002-postgres-for-auth-domain.md) | Postgres (PlanetScale) + Drizzle for the ai-data-room domain | accepted | 2026-04-22 |

### Flagged (draft needed when the owning slice reaches task execution)

- ADR-003 — S3 + Postgres-metadata split for document storage (`room-and-folders`).
- ADR-004 — Virtual canonical folders + Opportunity subroom cloning (`room-and-folders`).
- ADR-005 — Access-control middleware + download revalidator + NDA flow (`access-control`).
- ADR-006 — Templates-in-code + snapshot-per-org for checklist templates (`doc-checklist`).
- ADR-007 — Async SQS worker + Claude Haiku 4.5 default for sense-check (`ai-doc-sensecheck`).
- ADR-008 — Fail-yellow-never-blocks + golden-set eval harness (`ai-doc-sensecheck`).
- ADR-009 — pgvector in-VPC + double access-control filter + Sonnet 4.6 / Haiku 4.5 roles (`ai-search-qna`).
- ADR-010 — Stripe-as-SoT + plan limits in code + CLI back-door + read-only on past_due (`billing-subscription`).
