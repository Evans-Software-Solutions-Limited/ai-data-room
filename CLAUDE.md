# CLAUDE.md — ai-data-room

> Context for any Claude Code / Claude Agent SDK session working in this repo.
> This file is **canonical** — read it first.

## What this repo is

AI-native secure data room. First revenue-stream SaaS from Evans Software
Solutions Limited (Bradley Simms-Evans's company). First paying customer:
Capital Pay (where Bradley is incoming CTO), but commercial — not a
special deal.

Nine feature slices shipping toward `v1.0.0-mvp`. Specs live in
`.kiro/specs/ai-data-room/<slice>/{requirements,design,tasks}.md` —
that's the contract a PR must satisfy.

For the product context, read `docs/briefs/ai-data-room.md` once and
keep it cached. The brief is one page; if you find yourself wanting to
extend it, you're writing a spec.

## Reference repo: funds-distribution-platform

`funds-distribution-platform` ("FDP") is Bradley's most production-mature
repo at Capital Pay and the prime example for our conventions. It sits
on the same Bun + Turbo + SST v4 + TypeScript stack and uses the same
layered architecture and Kiro-style spec workflow. **When in doubt
about a pattern, grep FDP first.**

Local clone: `~/Documents/projects/funds-distribution-platform/`

Patterns we deliberately mirror from FDP:

- **`AGENTS.md`** at repo root — agent-agnostic ground rules.
- **`.kiro/specs/<feature>/{requirements,design,tasks}.md`** — three-file
  spec per slice; tasks reference requirements by number.
- **`docs/adr/NNN-<title>.md`** ↔ our `adr/NNN-<title>.md` —
  immutable ADRs, supersede rather than edit.
- **Layered architecture** — `domain/` → `application/` → `infrastructure/`
  → `handlers/` inside each microservice.
- **Integration tests** — `packages/db/test/integration/docker-compose.yml`
  with shared `setup.ts` helpers (`getTestPool`, `applyMigrations`,
  `truncateAllTables`, `destroyTestPool`). FDP uses MySQL; we use
  Postgres. CI uses GitHub Actions native `services:` block, not
  testcontainers — same shape locally and in CI.
- **Coverage guardrail** — 90% on lines / branches / functions /
  statements, enforced per-workspace by Vitest.
- **SST secret pattern** — `Resource.<NAME>.value`; secrets live in
  `infra/secrets.ts`; never inline.

What we deliberately **don't** mirror from FDP yet:

- FDP is multi-tenant with row-level isolation (per FDP ADR-001). We
  haven't shipped multi-org slicing yet — single-tenancy until the
  org model lands properly in slice 1 and is dogfooded.
- FDP uses MySQL on PlanetScale. We use Postgres on PlanetScale (per
  ADR-002) because slice 6 needs `pgvector`.

## Non-negotiables

1. **Spec before code.** Don't touch implementation until the slice's
   `design.md` is signed off (status field at top of file). If you
   think the spec is wrong, write an ADR proposal under
   `adr/NNN-<slug>.md` with status `proposed`, surface it in the PR,
   and pause. Don't silently diverge.
2. **Branch per task — never commit to `main`.** Feature branches
   follow `feat/<slice>-T-XXX-<short-desc>` (e.g.
   `feat/auth-and-orgs-T-002-workos-secrets`). Repo-hygiene work uses
   `chore/<short-desc>`. One task → one branch → one PR. `main` is only
   ever advanced by merging a PR.
3. **Layered architecture.** Handlers never import Drizzle types;
   infrastructure never imports handler types. See
   `microservices/core/src/api.ts` for the layout convention.
4. **Tests are not optional.** Every task in `tasks.md` has a
   `Tests required` line. Honour it. 90% coverage is a hard CI gate
   per workspace.
5. **`bun run test`, not `bun test`.** The latter runs Bun's built-in
   runner and fails on Vitest suites.
6. **Secrets via SST — declared only when their slice ships.** Never
   inline credentials; always `Resource.<NAME>.value` via
   `infra/secrets.ts`. **Do not pre-declare future-slice secrets.**
   SST resolves every `new sst.Secret(...)` at deploy time and refuses
   to deploy if any value is unset, so an unused declaration blocks
   every stage. `infra/secrets.ts` keeps a commented ledger of deferred
   secrets — uncomment (and link in `infra/api.ts`) only in the task
   that actually uses the secret.
7. **Typecheck is the primary guardrail.** `bun run typecheck` chains
   `tsc -p tsconfig.infra.json` (over `infra/` + `sst.config.ts`)
   followed by Turbo per-workspace `tsc --noEmit`. Both must pass —
   they catch different things. Infra globals come from
   `infra/_sst-globals.d.ts` (an ambient shim, see its header), not
   from SST's shipped `.d.ts`. The shim types `sst.aws.<Component>` as
   `any`, so SST component-name typos only surface at deploy time.
   **Run `bun sst diff --stage <your-dev>` before pushing any infra
   change** — that's the one check that resolves real component
   constructors.

## Default stack

- **Infra:** SST v4 (Ion). `.sst/` is gitignored. `sst-env.d.ts`
  (root + per-workspace) **is committed** — SST regenerates it on
  every `sst dev` / `sst deploy`, and the committed copy is what lets
  CI `bun run typecheck` catch missing-Resource mistakes without
  having to run SST first. Matches FDP.
- **DB:** PlanetScale Postgres + Drizzle (per ADR-002). Schema in
  `packages/db/src/schema/<slice>.ts`. Migrations generated via
  `bun run db:generate`, applied via `bun run db:migrate`.
  Hand-written SQL only for Postgres-specific DDL Drizzle can't emit
  (`pgvector`, partial unique, RLS).
- **Auth:** WorkOS AuthKit + User Management (per ADR-001). Wrappers
  in `microservices/core/src/infrastructure/workos/`.
- **AI:** Anthropic SDK via
  `microservices/core/src/infrastructure/anthropic/`. Prompt versions
  in a code module, not inline strings — see slice 5 design doc.
- **Payments:** Stripe via
  `microservices/core/src/infrastructure/stripe/` (slice 8).
- **Tests:** Vitest unit + integration; Playwright e2e (slice 1 T-012
  onward).

## Workflow for executing a slice's tasks.md

1. Read the slice's `requirements.md` then `design.md` in full.
2. Pick the lowest-numbered incomplete task from `tasks.md`.
3. Branch off `main`:
   `git checkout -b feat/<slice>-T-XXX-<short-desc>`. **Never commit
   to `main` directly.**
4. One PR per task unless the task explicitly bundles. PR title:
   `feat(<slice>): T-XXX <short description>`.
5. PR description mirrors the task: scope, files, DoD, tests run.
6. Run the full guard set before opening the PR:
   ```
   bun run typecheck && bun run test && bun run lint && bun run prettier:check
   ```
7. **Before pushing any infra change**, run
   `bun sst diff --stage <your-dev>`. The infra typecheck won't catch
   hallucinated SST component names (e.g. `sst.aws.KmsKey` doesn't
   exist; use Pulumi's `aws.kms.Key` + `sst.Linkable` — see FDP's
   `infra/kms.ts`). `sst diff` is the guardrail for SST component
   typos.
8. After CI is green and the PR is merged: tick the task `[x]` in
   `tasks.md`, delete the feature branch locally and on GitHub, pull
   `main`, branch again for the next task.
9. `release-please` handles versioning. Tag per slice.

## Slice dependency order

Per `.kiro/specs/ai-data-room/README.md`:

```
1. auth-and-orgs       — foundation
2. room-and-folders    — depends on 1
3. access-control      — depends on 2
4. doc-checklist       — depends on 2
5. ai-doc-sensecheck   — depends on 2
6. ai-search-qna       — depends on 2 (also needs pgvector)
7. admin-dashboard     — BFF aggregate; depends on 1–6
8. billing-subscription — parallelisable with 2–6 once 1 is done
9. onboarding-flow     — ties 1 + 8 together; ships last
```

Slices 4 / 5 / 6 can run in parallel once slice 2 lands.

## Currently in flight

See `HANDOFF.md` at repo root for the in-flight state. Read that next
if you're picking up the work cold.

## Where not to write

- `node_modules/`, `.sst/`, `.turbo/`, `dist/`, `coverage/` —
  gitignored.
- `adr/_TEMPLATE.md` — template; clone to `NNN-<slug>.md` when adding
  a new ADR.
- `packages/db/migrations/*.sql` — generated by `drizzle-kit generate`
  off the schema in `packages/db/src/schema/`. Hand-edit only when
  adding the Postgres-specific DDL drizzle can't emit (and add a
  comment explaining why).

## People

- **Bradley Simms-Evans** — owner. Lead Engineer → incoming CTO at
  Capital Pay, builds AI-native, full-stack TypeScript. Values
  maintainability and production-readiness. Available via PR review,
  not always immediate — design questions go in PR description, not
  Slack.
- **Rob** — CEO of Capital Pay. Sponsoring customer for v0.1; not a
  coder. Don't tag him in PRs.
- **Curtis** — to be pulled in for vendor-submission workflow review
  (flagged in the brief's open questions).
