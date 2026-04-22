# AGENTS.md — ai-data-room

Guidance for any AI coding agent (Claude Code, Codex, Cursor background agents, Agent SDK consumers) working on this repo.

Full context lives in [`CLAUDE.md`](./CLAUDE.md). This file is the agent-agnostic mirror of that information.

## Ground rules

1. **Read `.kiro/specs/ai-data-room/<slice>/{requirements,design,tasks}.md` before writing code.** These specs are the contract. Acceptance criteria (`AC-US*`) and non-functional requirements (`NFR*`) are testable; generated code must satisfy them.
2. **One task per PR, on its own branch — never commit to `main`.** Tasks are numbered `T-001`, `T-002`, … in each slice's `tasks.md`. Branch name: `feat/<slice>-T-XXX-<short-desc>` (e.g. `feat/auth-and-orgs-T-002-workos-secrets`). Use `chore/<short-desc>` for repo-hygiene work. Tick the checkbox in `tasks.md` only when the PR is merged.
3. **Layered architecture:** `domain` → `application` → `infrastructure` → `handlers`. Tests live alongside code (`__tests__/`) for unit, in `tests/` at repo root for e2e.
4. **No raw secrets, and no pre-declared future-slice secrets.** Use `Resource.<NAME>.value` from SST — registered in `infra/secrets.ts`. A secret is only declared (and linked in `infra/api.ts`) in the task that first uses it. SST resolves every `new sst.Secret(...)` at deploy time and refuses to deploy if any value is unset, so an unused declaration blocks all stages. The deferred-secret ledger at the bottom of `infra/secrets.ts` tracks which secrets belong to which future slice.
5. **Tests:**
   - Unit/integration: `bun run test` (Vitest). **Do not** use `bun test`.
   - E2E: `bun run test:e2e` (Playwright) — registered from slice 1 T-012 onward.
6. **Database:**
   - Schema in `packages/db/src/schema/<slice>.ts`.
   - Migrations generated via `bun run db:generate`, applied via `bun run db:migrate`.
   - Hand-written SQL only for Postgres-specific DDL Drizzle can't emit (pgvector, partial unique, RLS).
7. **Style:** Prettier defaults (see root `.prettierignore`); ESLint via `bun run lint` at each package.
8. **Commits:** Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`) — `release-please` parses them.

## What to do when a spec seems wrong

1. Stop.
2. Write an ADR proposal in `adr/NNN-<slug>.md` with status `proposed`.
3. Flag in the PR description and ask for sign-off in the upstream spec workspace.
4. Resume once the ADR is `accepted` and the spec is updated.

## Where not to write

- `node_modules/`, `.sst/`, `.turbo/`, `dist/`, `coverage/` — ignored.
- `.kiro/specs/**` — snapshot only; edits must originate in the upstream workspace and be synced down.
- `adr/_TEMPLATE.md` — template; clone to `NNN-<slug>.md` instead.
