# HANDOFF.md

> Ephemeral. This file describes what's currently in flight. Once T-004
> merges and the steady state is "look at `tasks.md`" again, the next
> agent should either rewrite this for the new in-flight task or delete
> it.

**Last updated:** 2026-04-28 by Claude Code (mid-session, after T-003
merged via PR #3 and T-004 was scaffolded on a new branch).

## Where we are in slice 1 (auth-and-orgs)

| Task   | Status | Notes                                                                                            |
| ------ | ------ | ------------------------------------------------------------------------------------------------ |
| T-001  | ✅     | Repo scaffold.                                                                                   |
| T-002  | ✅     | WorkOS + secrets wiring (PR #1).                                                                 |
| T-003  | ✅     | Postgres + Drizzle setup, integration test scaffold (PR #3).                                     |
| T-004  | 🚧     | Domain layer: types + zod schemas. **Branch `feat/auth-and-orgs-T-004-domain-types-zod` ready.** |
| T-005… | ⏳     | See `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`.                                           |

## In flight: T-004 — domain types + zod schemas

Branch `feat/auth-and-orgs-T-004-domain-types-zod` adds:

- `packages/api-utils/src/schemas/auth-orgs.ts` — canonical zod schemas
  for the six aggregates listed in T-004 spec (`Org`, `User`,
  `OrgMembership`, `ExternalAccessGrant`, `Invitation`, `AuditEvent`)
  plus the eight primitive enums (`Role`, `LifecycleState`,
  `AuditOutcome`, `AuditEventType`, `InvitationKind`, `InvitationState`,
  `InvitationRole`, `ExternalAccessGrantStatus`).
  - Inferred types are exported alongside the schemas — the file is the
    single source of truth.
  - `InvitationSchema.superRefine` enforces the design.md
    `(kind, role, opportunitySlug)` invariant (internal needs role + no
    slug, external needs slug + no role).
  - `AuditEventTypeSchema` is exhaustively asserted vs. FR24's 21 event
    types in the schemas test (the lint-rule-or-test option called out
    in T-004 DoD).
- `microservices/core/src/domain/{org,user,invitation,audit}.ts` —
  type-only barrels that re-export the inferred types from api-utils.
  Domain stays runtime-zod-free; the schemas live one layer up.
- `packages/api-utils/src/schemas/__tests__/auth-orgs.test.ts` — 69
  tests covering happy + failure per schema, FR24 exhaustiveness, and
  the GDPR-tombstone path on `UserSchema` (NFR9).
- `microservices/core/vitest.config.ts` — adds `src/domain/**/*.ts` to
  coverage exclude (type-only files; v8 can't measure them; FDP
  precedent).

### Guard set status (last run on this branch)

```
bun run typecheck      ✅
bun run test           ✅ — 69 tests in api-utils, 100% coverage; web/db/core unchanged
bun run lint           ✅
bun run prettier:check ✅
```

`sst diff` not run for T-004 — no infra changes on this branch. The
infra-typecheck portion of `bun run typecheck` did run (it's the first
phase) and passed.

### What you need to do to ship T-004

1. **Stage + commit.** Suggested commit shape:

   ```
   feat(auth-and-orgs): T-004 — domain types + zod schemas

   * packages/api-utils/src/schemas/auth-orgs.ts is the canonical source
     of truth for the six aggregates + primitive enums.
   * microservices/core/src/domain/{...}.ts re-exports inferred types
     so the domain layer reads as a barrel-per-aggregate.
   * AuditEventType exhaustiveness vs. FR24 verified by test.
   ```

2. **Push** `feat/auth-and-orgs-T-004-domain-types-zod`, open PR with the
   matching `feat(auth-and-orgs): T-004 ...` title.
3. **Watch CI.** Six jobs (same as PR #3): typecheck-lint-prettier,
   build, unit-tests, db-checks (drift — won't fire, no `packages/db`
   changes), db-integration (won't fire, same reason), and any others.
   Only the first three should be exercised.
4. **Tick T-004 `[x]`** in `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`
   after merge (currently `[~]` for in-PR-review). Delete the merged
   branch locally + remote.

## After T-004 merges → T-005

T-005 is the "drizzle migrations: six tables" task. Branch from a
freshly-pulled `main`:

```bash
git checkout main && git pull
git checkout -b feat/auth-and-orgs-T-005-drizzle-migrations
```

Note that T-003 absorbed the **first** auth migration (the one that
created the six base tables), per the T-003 outcome notes. T-005's
remaining deliverables:

- Augment with the Postgres-specific DDL Drizzle can't emit: `citext`
  on `users.email` + `invitations.email`, the unique partial index for
  single-owner-per-org (`(org_id) where role='owner'`), and any other
  partial / functional index that needs hand-written SQL.
- Manual reverse migrations.
- Per-repo integration test that spins up a test DB, applies, inserts
  one happy-path row per table, and queries it back.

## Sticky knowledge — kept across handoffs

These are still relevant after T-004:

1. **Drizzle 0.30+ moved bookkeeping into a `drizzle` schema.** Reset
   logic must drop both `public` and `drizzle` (or truncate
   `drizzle.__drizzle_migrations`).
2. **SST component-name typos only surface at deploy time** (`sst.aws.*`
   is `any` in the ambient shim). Always `bun sst diff --stage <dev>`
   before pushing infra changes. T-004 has no infra delta, so this
   wasn't exercised; keep it in mind for T-014 / T-018.
3. **Don't pre-declare future-slice secrets.** SST refuses to deploy
   if any declared secret is unset.
4. **Local docker-compose is `ai-data-room-test-db`-prefixed** to avoid
   colliding with FDP's compose stack. Used by db integration tests in
   T-003 / T-005 / T-007.
5. **`bun run test`, not `bun test`.** Bun's built-in runner doesn't
   support our Vitest setup.
6. **`.claude/` is gitignored + prettier-ignored.** First-run agents
   don't need to do anything special.
