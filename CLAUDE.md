# CLAUDE.md — ai-data-room (repo-level)

> Context for any Claude Code / Claude Agent SDK session working *inside this repo*.
> The upstream Cowork session's CLAUDE.md lives in the project workspace (`~/.../Automation, AI Workflows & Revenue Streams/CLAUDE.md`) and carries Bradley-level context.
> **This file is narrower** — repo conventions, not life story.

## What this repo is

AI-native secure data room. Nine feature slices shipping toward `v1.0.0-mvp`.

Spec snapshot lives in `.kiro/specs/ai-data-room/<slice>/` — the `requirements.md` / `design.md` / `tasks.md` that govern what a given PR must satisfy. The canonical source is the upstream workspace; `.kiro/` is a checked-in copy that moves in lock-step.

## Non-negotiables

1. **Spec before code.** Don't touch implementation until the slice's `design.md` is signed off in the upstream spec workspace. If you think the spec is wrong, update the spec first, get sign-off, then code.
2. **Branch per task — never commit to `main`.** Feature branches follow `feat/<slice>-T-XXX-<short-desc>` (e.g. `feat/auth-and-orgs-T-002-workos-secrets`). One task → one branch → one PR. `main` is only ever advanced by merging a PR. Scaffold / repo-hygiene work uses `chore/<short-desc>`.
3. **Layered architecture.** See `microservices/core/src/README.md`. Handlers never import Drizzle types; infrastructure never imports handler types.
4. **Tests are not optional.** Every task listed in `.kiro/specs/ai-data-room/<slice>/tasks.md` has a `Tests required` line. Honour it.
5. **`bun run test`, not `bun test`.** The latter runs Bun's built-in runner and fails on Vitest suites.
6. **Secrets via SST — declared only when their slice ships.** Never inline credentials; use `Resource.<NAME>.value` via `infra/secrets.ts`. **Do not pre-declare future-slice secrets.** SST resolves every `new sst.Secret(...)` at deploy time and refuses to deploy if any value is unset, so an unused declaration blocks every stage. `infra/secrets.ts` keeps a commented ledger of deferred secrets — uncomment (and link in `infra/api.ts`) only in the task that actually uses the secret.

## Default stack reminders

- **Infra:** SST v4 (Ion). Never check in `.sst/` or `sst-env.d.ts`.
- **DB:** PlanetScale Postgres + Drizzle. Migrations in `packages/db/migrations/`.
- **Auth:** WorkOS. Wrappers in `microservices/core/src/infrastructure/workos/`.
- **AI:** Anthropic SDK via `microservices/core/src/infrastructure/anthropic/`. Prompt versions in a code module, not inline strings — see slice 5 design doc.
- **Payments:** Stripe via `microservices/core/src/infrastructure/stripe/`.
- **Tests:** Vitest unit + integration; Playwright e2e.

## Workflow for executing a slice's tasks.md

1. Read the slice's `.kiro/specs/ai-data-room/<slice>/requirements.md` then `design.md` in full.
2. Pick the lowest-numbered incomplete task from `tasks.md`.
3. Create the task's feature branch off the current `main`: `git checkout -b feat/<slice>-T-XXX-<short-desc>`. **Never commit to `main` directly.**
4. One PR per task unless the task explicitly bundles (e.g. "T-003 → T-005 bundle for schema + types + zod"). PR title: `feat(<slice>): T-XXX <short description>`.
5. PR description mirrors the task: scope, files, DoD, tests run. Tick the task `[x]` in the upstream `tasks.md` (and the mirrored `.kiro/` copy) only when the PR is merged.
6. Run `bun run typecheck && bun run test && bun run lint` before opening the PR.
7. After merge, delete the feature branch locally and on GitHub. Pull `main`, branch again for the next task.
8. `release-please` handles versioning. Tag per slice.

## Parallelism

Once slice 1 lands, slices 2 and 8 can run in parallel. Slices 4/5/6 can run in parallel once slice 2 lands. Slices 7 and 9 tie it together — they ship last.

## Where things live

See `README.md` §Repo layout and `microservices/core/src/README.md` for the layered convention. If something doesn't have an obvious home, check the most-recently-drafted design doc — chances are the answer is there.
