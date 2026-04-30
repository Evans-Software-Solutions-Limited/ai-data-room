# HANDOFF.md

> Ephemeral. Describes what's currently in flight. Refreshed on every
> task transition; delete once steady state ("look at `tasks.md`") is
> safe to assume.

**Last updated:** 2026-04-29 by Claude Code (mid-session, after T-007
merged via PR #7 and T-013 was scaffolded on a new branch).

## Where we are in slice 1 (auth-and-orgs)

| Task  | Status | Notes                                                                                            |
| ----- | ------ | ------------------------------------------------------------------------------------------------ |
| T-001 | ✅     | Repo scaffold.                                                                                   |
| T-002 | ✅     | WorkOS + secrets wiring (PR #1).                                                                 |
| T-003 | ✅     | Postgres + Drizzle setup (PR #3).                                                                |
| T-004 | ✅     | Domain types + zod schemas (PR #4).                                                              |
| T-005 | ✅     | Postgres-specific DDL augments (PR #5).                                                          |
| T-006 | ✅     | WorkOS client wrapper + webhook verifier (PR #6).                                                |
| T-007 | ✅     | Typed Drizzle repositories (PR #7).                                                              |
| T-008 | ⏳     | Application layer: signup + callback flow.                                                       |
| T-009 | ⏳     | Application layer: invitations.                                                                  |
| T-010 | ⏳     | Application layer: MFA enrolment hook + recovery codes.                                          |
| T-011 | ⏳     | Application layer: password reset.                                                               |
| T-012 | ⏳     | Application layer: suspension lifecycle.                                                         |
| T-013 | 🚧     | Application layer: audit event writer. **Branch `feat/auth-and-orgs-T-013-audit-event-writer`.** |
| T-014 | ⏳     | Handlers: HTTP routes (depends on the application-layer fan-out below).                          |
| T-016 | ⏳     | WorkOS webhook handler.                                                                          |

## In flight: T-013 — application-layer audit event writer

T-013 is the first task in the application-layer fan-out unblocked
by T-007. It's intentionally landing first because every other
application-layer task (T-008 / T-009 / T-010 / T-011 / T-012 /
T-016 / T-019) writes audit events through it — landing the
contract first means the rest can import a stable surface instead
of inlining audit calls.

`microservices/core/src/application/audit.ts` exposes one function:

```ts
recordAuditEvent(input: RecordAuditEventInput, deps: { auditRepo }): Promise<AuditEvent>
```

Two responsibilities beyond the repo's:

1. **Validate** the input against a zod schema derived from the
   canonical `AuditEventSchema` (T-004) via `.omit({ id, occurredAt,
... })`. Schema drift in design.md threads through to T-013
   automatically — no field-by-field duplication of the canonical.
2. **Strip NFR8-forbidden material** from metadata (passwords, MFA
   codes, recovery codes, session/reset/invite tokens). The strip
   is regex-driven (`/password|token|secret|recovery_?code|mfa_?code/i`)
   so a callsite accidentally including `passwordHash` or
   `magicAuthToken` is also caught. Defense-in-depth — callers
   should still treat metadata as "no secrets" themselves.

Handlers MUST NOT call `AuditRepo.write` directly; the only path is
`recordAuditEvent`. T-008+ will follow this convention.

### Tests

20 unit tests at `microservices/core/src/application/__tests__/audit.test.ts`
with a mocked `AuditRepo`:

- **Happy path** (2): validates + forwards to repo, normalises
  optional null fields to explicit nulls.
- **Validation** (5): rejects events missing eventType / outcome /
  sourceIp; rejects malformed sourceIp; rejects an event type that
  isn't one of the FR24 21.
- **NFR8 stripping** (13): one parameterised `it.each` test
  covering 11 forbidden-key shapes (camel + snake variants), one
  asserting `email` survives the strip (NFR8 explicitly allows
  email in audit metadata), one asserting empty metadata
  round-trips as `{}`.

Workspace coverage: 100 / 96.15 / 100 / 100 (gate 90 %).

### What T-013 explicitly does NOT cover

The T-013 DoD says "every of the 21 FR24 event types is produced by
some callsite in the codebase (verified by a grep-style test)".
That's a slice-level assertion that only becomes meaningful after
T-008 / T-009 / T-010 / T-011 / T-012 / T-016 / T-019 land — the
21-types-covered test belongs to T-022 (slice sign-off + traceability
matrix), not this PR. Called out in the PR description.

### Guard set status (last run on this branch)

```
bun run typecheck                 ✅
bun run test                      ✅ — 55 unit tests in core (T-013 adds 20)
bun run lint                      ✅
bun run prettier:check            ✅
```

`sst diff` not run for T-013 — no infra changes on this branch.

### What you need to do to ship T-013

1. **Stage + commit.** Suggested:
   ```
   feat(auth-and-orgs): T-013 — application-layer audit event writer
   ```
2. **Push** `feat/auth-and-orgs-T-013-audit-event-writer`, open PR
   with matching title.
3. **Watch CI.** Six jobs (typecheck-lint-prettier, build, unit-tests,
   install, detect-changes, plus the `core-integration` job that
   re-runs the T-007 repo suite since `microservices/core/**`
   changed). DB jobs skip — no `packages/db/**` delta.
4. **Tick T-013 `[x]`** in `.kiro/specs/ai-data-room/auth-and-orgs/tasks.md`
   after merge (currently `[~]`). Delete the branch.

## After T-013 merges → continue the application-layer fan-out

The remaining application-layer tasks are all parallelisable now
(they depend on T-006 + T-007, both shipped). Pick any order; one
operator or fan out to multiple Claude Code sessions:

- **T-008** signup/login callback (the canonical user flow).
- **T-009** invitations.
- **T-010** MFA enrolment hook + recovery codes.
- **T-011** password reset.
- **T-012** suspension lifecycle.
- **T-016** WorkOS webhook handler routing.
- **T-019** GDPR hard-delete (uses `UserRepo.scrubPii` + audit writer).

Each will import `recordAuditEvent` from `application/audit.ts`.

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
   avoid colliding with FDP's compose stack.
5. **`bun run test`, not `bun test`.** Bun's built-in runner doesn't
   support our Vitest setup.
6. **`.claude/` is gitignored + prettier-ignored.**
7. **Migration naming**: drizzle-kit emits `0001_<random_nouns>.sql`;
   we rename to `0001_<intent>.sql` and update the `tag` in
   `meta/_journal.json`.
8. **Hand-edited migrations** — pair every hand-touched `*.sql` with
   a `*.down.sql` outside the migrations folder drizzle reads.
9. **WorkOS SDK names** — `userManagement.sendInvitation` (not
   `createInvitation`), `userManagement.createPasswordReset` (no
   `sendPasswordResetEmail` method). The wrapper at
   `infrastructure/workos/client.ts` bridges them.
10. **WorkOS webhooks need a synthetic clientId** — `new WorkOS({})`
    throws; PKCE-mode `new WorkOS({ clientId: ... })` is the
    workaround for signature-verification-only paths.
11. **Repos use `firstOrNull` for "select-one or null" and
    `firstOrThrow` for "update-must-find-row"** —
    `_helpers.ts` is the single home. UPDATE methods that returned
    `undefined as Type` were one of T-007's bugbot findings.
12. **AuditRepo cursor is composite `(occurredAt, id) < (cursor)`** —
    the id half is load-bearing for events sharing a millisecond.
    Was the second T-007 bugbot finding.
13. **All audit writes go through `application/audit.ts#recordAuditEvent`**,
    never `AuditRepo.write` directly. Validates the canonical shape
    - strips NFR8 forbidden material. Added in T-013.
14. **Integration tests run in two suites** —
    `db:test:integration` for schema, `core:test:integration` for
    repos. Both reuse `packages/db/test/integration/setup.ts`.
