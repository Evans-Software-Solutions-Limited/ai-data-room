# HANDOFF.md

> Ephemeral. Describes what's currently in flight. Refreshed on every
> task transition; delete once steady state ("look at `tasks.md`") is
> safe to assume.

**Last updated:** 2026-04-28 by Claude Code (mid-session, after T-005
merged via PR #5 and T-006 was scaffolded on a new branch).

## Where we are in slice 1 (auth-and-orgs)

| Task   | Status | Notes                                                                                               |
| ------ | ------ | --------------------------------------------------------------------------------------------------- |
| T-001  | ✅     | Repo scaffold.                                                                                      |
| T-002  | ✅     | WorkOS + secrets wiring (PR #1).                                                                    |
| T-003  | ✅     | Postgres + Drizzle setup, integration test scaffold (PR #3).                                        |
| T-004  | ✅     | Domain types + zod schemas (PR #4).                                                                 |
| T-005  | ✅     | Postgres-specific DDL augments (PR #5).                                                             |
| T-006  | 🚧     | Infrastructure: WorkOS client wrapper. **Branch `feat/auth-and-orgs-T-006-workos-client-wrapper`.** |
| T-007… | ⏳     | See `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`.                                              |

## In flight: T-006 — WorkOS client wrapper

Two new files at `microservices/core/src/infrastructure/workos/`:

- **`client.ts`** — `createWorkOSClient({ apiKey, clientId })` factory
  returning the eight operations the auth-and-orgs design.md actually
  consumes: `getAuthorizationUrl`, `authenticateWithCode`, `getUser`,
  `deleteUser`, `createInvitation`, `revokeInvitation`,
  `sendPasswordResetEmail`, `revokeSession`. Two SDK-name divergences
  documented at the top of the file:
  - `createInvitation` → SDK's `userManagement.sendInvitation`.
  - `sendPasswordResetEmail` → SDK's `userManagement.createPasswordReset`
    (the SDK has no `sendPasswordResetEmail` method at v8; the rename
    keeps the wrapper's name aligned with the T-006 spec).

  The factory pattern (no class, no module-scope WorkOS instance) is
  side-effect-free at module load — verified by a test. SDK types
  (`User`, `Invitation`, `AuthenticationResponse`, `PasswordReset`,
  …) are re-exported so `application/*.ts` never has to
  `import "@workos-inc/node"` directly. That keeps the layered-
  architecture rule clean.

- **`webhook.ts`** — `verifyWorkOSWebhook({ rawBody, signatureHeader, secret, tolerance? })`
  returns a tagged-union `{ ok: true; event } | { ok: false; reason; error? }`.
  Failure reasons split four ways: `missing_signature`, `missing_secret`,
  `invalid_json`, `invalid_signature`. The first three short-circuit
  before reaching the SDK so a wiring bug isn't reported as
  "Invalid signature" in logs.

  Construct happens via `new WorkOS({ clientId: WEBHOOK_VERIFY_SDK_CLIENT_ID })`
  — PKCE-mode constructor since signature verification is HMAC-only.
  The clientId is never sent over the wire; the SDK shape just
  requires us to pick one of `{apiKey, clientId}`.

### Tests

- **`client.test.ts`** (10 tests) — mocks `@workos-inc/node` via
  hoisted spies, asserts each of the 8 operations delegates with the
  right argument shape. Includes the "no construction at module
  load" T-006 DoD assertion.
- **`webhook.test.ts`** (8 tests) — uses the SDK's own
  `webhooks.computeSignature` to mint real signatures, then runs them
  through the verifier. Covers happy path, tampered body, tampered
  signature, wrong secret, stale timestamp (with `tolerance: 0`), and
  the three structural-failure paths (missing header / missing secret
  / invalid JSON).

35 tests in `@ai-data-room/core` overall (T-006 adds 18). Coverage at
100 % stmts / 95.34 % branches / 100 % funcs / 100 % lines for the
workspace, well above the 90 % gate. Two uncovered branches
(`err instanceof Error ? err.message : "unknown"` fallbacks in
webhook.ts) are deliberately left — JSON.parse and constructEvent
both throw real Error objects, so the fallback would need a contrived
mock to hit.

### Guard set status (last run on this branch)

```
bun run typecheck      ✅
bun run test           ✅ — 35 core tests; web/db unchanged
bun run lint           ✅
bun run prettier:check ✅
```

`sst diff` not run for T-006 — no infra changes on this branch.

### What you need to do to ship T-006

1. **Stage + commit.** Suggested:
   ```
   feat(auth-and-orgs): T-006 — WorkOS client wrapper + webhook verifier
   ```
2. **Push** `feat/auth-and-orgs-T-006-workos-client-wrapper`, open PR
   with matching title.
3. **Watch CI.** Same six jobs as PR #4 (no `packages/db/**` touched,
   so db jobs skip): typecheck-lint-prettier, build, unit-tests,
   plus install + detect-changes.
4. **Tick T-006 `[x]`** in `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`
   after merge (currently `[~]`). Delete the branch locally + remote.

## After T-006 merges → T-007

T-007 is **typed Drizzle repositories** (`OrgRepo`, `UserRepo`,
`MembershipRepo`, `ExternalGrantRepo`, `InvitationRepo`, `AuditRepo`).
Branch from a freshly-pulled main:

```bash
git checkout main && git pull
git checkout -b feat/auth-and-orgs-T-007-typed-repositories
```

Scope from `tasks.md`:

- One repo file per aggregate at
  `microservices/core/src/infrastructure/db/<aggregate>.ts`. No
  business logic; only the queries the application layer needs.
- One integration test per repo method against a transactional test
  DB (the `packages/db/test/integration/` scaffold from T-003 + T-005
  is ready for it).
- No SQL string interpolation — Drizzle query builders or
  parameterised SQL only.

After T-007, the parallelisable application-layer fan-out (T-008
through T-013, T-016) opens up.

## Sticky knowledge — kept across handoffs

1. **Drizzle 0.30+ moved bookkeeping into a `drizzle` schema.** Reset
   logic must drop both `public` and `drizzle` (or truncate
   `drizzle.__drizzle_migrations`).
2. **SST component-name typos only surface at deploy time** (`sst.aws.*`
   is `any` in the ambient shim). Always `bun sst diff --stage <dev>`
   before pushing infra changes.
3. **Don't pre-declare future-slice secrets.** SST refuses to deploy
   if any declared secret is unset.
4. **Local docker-compose is `ai-data-room-test-db`-prefixed** to
   avoid colliding with FDP's compose stack. Used by
   `db:test:integration`.
5. **`bun run test`, not `bun test`.** Bun's built-in runner doesn't
   support our Vitest setup.
6. **`.claude/` is gitignored + prettier-ignored.** First-run agents
   don't need to do anything special.
7. **Migration naming**: drizzle-kit emits `0001_<random_nouns>.sql`;
   we rename to `0001_<intent>.sql` and update the `tag` in
   `meta/_journal.json`. `migrations/README.md` documents the convention.
8. **Hand-edited migrations** — drizzle-kit can't emit `CREATE
EXTENSION` or other Postgres-only DDL; pair every hand-touched
   `*.sql` with a `*.down.sql` (kept outside the migrations folder
   drizzle reads, run manually for rollback).
9. **WorkOS SDK names** — `userManagement.sendInvitation` (not
   `createInvitation`), `userManagement.createPasswordReset` (no
   `sendPasswordResetEmail` method). The wrapper at
   `infrastructure/workos/client.ts` is the only place that bridges
   the spec-level names to the SDK names; T-014 handlers should never
   touch the SDK directly.
10. **WorkOS webhooks need a synthetic clientId** — `new WorkOS({})`
    throws; PKCE-mode `new WorkOS({ clientId: ... })` is the workaround
    for signature-verification-only paths. The SDK never sends the
    clientId in HMAC operations.
