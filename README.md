# ai-data-room

AI-native secure data room. First revenue-stream SaaS from Evans Software Solutions Limited.

> Spec-driven development, Kiro-style: Requirements → Design → Tasks → Implementation.
>
> All context lives in this repo. Start with [`AGENTS.md`](./AGENTS.md) (or [`CLAUDE.md`](./CLAUDE.md) if you're a Claude-family agent), then read the brief at [`docs/briefs/ai-data-room.md`](./docs/briefs/ai-data-room.md), then dive into the slice you're picking up at [`.kiro/specs/ai-data-room/<slice>/`](./.kiro/specs/ai-data-room/). Architecture decisions live in [`adr/`](./adr/).
>
> If you're a fresh agent walking in cold, current per-slice status is the `**Status:**` header + task ticks in each slice's `tasks.md`. Session handoffs are delivered in chat, not committed files.

## Stack

- **Infra:** AWS SST v4 (Ion), TypeScript end-to-end.
- **Backend:** Elysia + Hono (Lambda adapter), layered domain / application / infrastructure / handlers.
- **Database:** PlanetScale Postgres + Drizzle ORM + `drizzle-kit` (per [ADR-002](./adr/002-postgres-for-auth-domain.md)).
- **Auth:** WorkOS AuthKit + User Management (per [ADR-001](./adr/001-workos-as-auth-platform.md)).
- **Vector search:** `pgvector` in-VPC (slice 6).
- **AI:** Claude Haiku 4.5 (sense-check), Claude Sonnet 4.6 (Q&A generator), Claude Haiku 4.5 (Q&A re-ranker).
- **Payments:** Stripe Checkout + Billing Portal + signed webhooks.
- **Web:** Vite SPA for the foundation slice; migrate to Next.js in slice 2.

## Get started

Prereqs: Bun 1.3.9+, AWS credentials, SST v4 CLI.

```bash
bun install
bun sst secret set WorkOSApiKey <value>     # per-stage; repeat for each secret in infra/secrets.ts
bun run db:generate                          # regenerate migrations from schema
bun run db:migrate                           # apply to the DATABASE_URL target
bun run dev                                  # sst dev — brings up core API + web
```

## Repo layout

```
ai-data-room/
├── .kiro/                            # Kiro spec snapshot (per-slice requirements/design/tasks)
├── adr/                              # Local ADRs (MVP-scope decisions during implementation)
├── infra/                            # SST v4 infra modules
│   ├── api.ts                        #   API Gateway(s)
│   ├── web.ts                        #   Static site / Next.js front-end
│   ├── storage.ts                    #   S3 buckets + KMS key
│   ├── secrets.ts                    #   Centralised sst.Secret registry
│   └── db.ts                         #   DB-adjacent AWS resources
├── microservices/
│   ├── core/                         #   main HTTP API — all feature slices mount here
│   └── workers/                      #   async workers (sense-check SQS, reconciliation, …)
├── packages/
│   ├── api-utils/                    #   shared zod schemas + env/jwt helpers
│   ├── db/                           #   Drizzle schema + migrations + typed repos
│   └── web/                          #   front-end
├── sst.config.ts                     #   SST v4 app config
└── turbo.json                        #   Turborepo task graph
```

## Slice roadmap

Dependency-correct order per the upstream `specs/ai-data-room/README.md`:

1. `auth-and-orgs` — foundation
2. `room-and-folders`
3. `access-control`
4. `doc-checklist`
5. `ai-doc-sensecheck`
6. `ai-search-qna`
7. `admin-dashboard`
8. `billing-subscription` (parallelisable with 2–6 once 1 is done)
9. `onboarding-flow`

Each slice is executed by a Claude Code agent reading its own `tasks.md`. The agent merges PRs against this repo; merge unblocks the next slice.

## Testing

- Unit: Vitest via `bun run test` (**not** `bun test` — latter runs Bun's built-in runner and fails).
- Integration: Vitest against a local Postgres via docker-compose (added slice 1 T-004).
- E2E: Playwright (added slice 1 T-012).
- Coverage thresholds: 90% for `application/` and `infrastructure/db/repositories/` (inherited from template `vitest.config.ts`).

## Deployment

- `dev` (personal), `staging`, `prod` SST stages.
- `release-please` drives versioning on main. Tag scheme: `v0.<slice>.0-<slice-name>` until `v1.0.0-mvp`.
- Runbook: see `docs/deployment.md` (inherited stub from template — flesh out during slice 1 T-014).
