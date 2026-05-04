# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-04 by Claude Code, mid-flight on T-016.
Branch `feat/auth-and-orgs-T-016-webhook-routing` is open and
awaiting review. T-019 (GDPR delete) merged yesterday as PR #16.

## Currently in flight

**T-016 — WorkOS webhook routing.** First wiring task in slice 1
(after the application fan-out finished with T-019). A dedicated
Lambda at `POST /webhooks/workos` that verifies the WorkOS HMAC
signature → dedups via a new `webhook_deliveries` ledger →
routes to one of three application handlers (`handleUserDeleted`,
`handlePasswordResetCompleted`, `acceptInvitation`).

The dedup ledger is the load-bearing piece of the spec's "replay
3× → exactly one audit row + one state change" guarantee. The
application handlers are independently idempotent for state, but
each emits a `failure / already_*` audit row on redelivery —
without dedup that'd violate the spec.

What changed:

- `packages/db/src/schema/auth.ts` — new `webhook_deliveries`
  table (event_id PK, event_type, received_at).
- `packages/db/migrations/0002_webhook_deliveries.sql` —
  drizzle-generated migration (renamed from random nouns).
- `microservices/core/src/infrastructure/db/webhookDeliveryRepo.ts`
  (~95 LOC) — `markDelivered(eventId, eventType)` returning
  `{ firstDelivery, delivery }` via INSERT ... ON CONFLICT DO
  NOTHING + conditional SELECT.
- `microservices/core/test/integration/db/webhookDeliveryRepo.integration.test.ts`
  (~95 LOC, 4 tests) — proves the dedup contract on real
  Postgres including the literal "replay 3× yields one row"
  DoD assertion.
- `microservices/core/src/handlers/webhooks/workos.ts` (~225 LOC)
  — `routeWorkOSWebhook(event, deps)`: pure routing logic with
  deps-injected for testing. Verifies signature → dedups →
  switches on `event.event` to one of 3 routes. Other event
  types ack as `{ ignored: true }` (includes the MFA events
  whose application handlers exist but have no matching WorkOS
  event in v8.13's SDK — investigation deferred).
- `microservices/core/src/handlers/webhooks/workosLambda.ts` —
  thin Lambda wrapper that constructs production deps from
  `Resource.*` + `getDb()` and hands off to
  `routeWorkOSWebhook`. Excluded from the unit-coverage gate
  (mirroring the `src/api.ts` precedent — pure wiring).
- `microservices/core/src/handlers/webhooks/__tests__/workos.test.ts`
  (~470 LOC, 14 tests) — covers signature verification (incl.
  truly-absent header), dedup short-circuit, each routing
  branch, the handler-exception path, and the audit-context
  fallbacks.
- `infra/api.ts` — uncommented the `POST /webhooks/workos`
  route wiring (was a TODO since T-006).
- `microservices/core/vitest.config.ts` — excluded the
  Lambda wrapper from the coverage gate.
- `sst-env.d.ts` — manually added the `PLANETSCALE_DATABASE_URL`
  type entry with a `// MANUAL ENTRY (T-016)` marker; will be
  cleanly overwritten on the next `bun sst dev` regen.

Local guard set green: `typecheck` (force), `test:unit` (force —
154/154 with workos.ts at 100/94.73/100/100), `lint`,
`prettier:check`. Awaiting CI + Cursor Bugbot + Brad's review.

### Departures from the brief after the simplify review

1. **Collapsed the `handlerDeps` factory shape.** First-pass
   handler had three `() => Deps` factory closures (one per
   event type) for "lazy" dep construction. Reviewers flagged
   the lazy bit as nil-value: every dep is already constructed
   in the production wrapper before the factories are called.
   Replaced with a `routes` shape: pre-bound
   `(input) => Promise<result>` invocations. Tests now inject
   `vi.fn()` mocks directly without `vi.spyOn` on application
   modules; production wires by binding repo+SDK deps.
2. **Replaced the defensive `firstDelivery: true` fallback** in
   `WebhookDeliveryRepo.markDelivered` with a loud
   `throw new Error(...)`. The fallback would have silently
   bypassed dedup if INSERT skipped AND SELECT missed — exactly
   the wrong shape for the spec's "exactly one audit row"
   guarantee. The branch is unreachable in v0.1 (no DELETE
   path on the table); failing loud is better than silently
   short-circuiting.
3. **Stripped `error: err.message` from the 500 response body**
   to avoid leaking internal detail (DB connection strings,
   driver paths) into WorkOS's webhook delivery log. Full error
   is `console.error`'d for forensics instead.
4. **Dropped the `WorkOS-Signature` TitleCase header fallback**
   — API Gateway HTTP API v2 normalizes header names to
   lowercase, so the TitleCase branch was dead code.
5. **Split the file into routing + Lambda wiring.** `workos.ts`
   holds `routeWorkOSWebhook` (testable, in coverage gate);
   `workosLambda.ts` holds the production `handler` that wires
   `Resource.*` (excluded as pure wiring, mirrors `src/api.ts`).
   Avoids a 6-module mock just to bump coverage.

### Deliberately not done in this PR (reviewer flagged, deferred)

- **Real WorkOS event names for MFA enrolment / recovery code
  used.** The application handlers `handleMfaEnrolled` and
  `handleRecoveryCodeUsed` exist but have no matching event in
  the v8.13 WorkOS SDK union. Investigation (WorkOS docs / SDK
  upgrade / event-shape inference from `user.updated`) is a
  follow-up — for now, both event types ack as
  `{ ignored: true }`.
- **Session events** (`session.created`, `session.revoked`).
  Acked as ignored — `session.revoked` should bust the session
  cache that lands in T-015. Wired then.
- **Helper extraction follow-ups** still deferred: shared
  `lookupUserOrAuditFailureForWebhook`, `revokeAllActiveSessions`,
  `AUDIT_REASONS` constants, shared test fixtures.

### Operator note

The `sst-env.d.ts` manual edit will be silently overwritten by
the next `bun sst dev` / `bun sst deploy` regen — that's fine,
the regen will produce the same line because
`PLANETSCALE_DATABASE_URL` is a real declared secret in
`infra/secrets.ts` and a real link on the core API Lambda.

## Where we are in slice 1 (auth-and-orgs)

| Task  | Status                     | Notes                                                                              |
| ----- | -------------------------- | ---------------------------------------------------------------------------------- |
| T-001 | ✅                         | Repo scaffold.                                                                     |
| T-002 | ✅                         | WorkOS + secrets wiring (PR #1).                                                   |
| T-003 | ✅                         | Postgres + Drizzle setup (PR #3).                                                  |
| T-004 | ✅                         | Domain types + zod schemas (PR #4).                                                |
| T-005 | ✅                         | Postgres-specific DDL augments (PR #5).                                            |
| T-006 | ✅                         | WorkOS client wrapper + webhook verifier (PR #6).                                  |
| T-007 | ✅                         | Typed Drizzle repositories (PR #7).                                                |
| T-013 | ✅                         | Application-layer audit event writer (PR #8).                                      |
| T-008 | ✅                         | Signup + login callback flows (PR #9).                                             |
| T-012 | ✅                         | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).                       |
| T-011 | ✅                         | Password reset (PR #12).                                                           |
| T-010 | ✅                         | MFA enrolment + recovery-code-used audit (PR #13, scope trimmed by ADR-003).       |
| –     | ✅                         | Chore: repos accept `Db \| PgTransaction` + signup wraps multi-write (PR #14).     |
| T-009 | ✅                         | Application: invitations (PR #15, 4 functions incl. multi-write acceptInvitation). |
| T-019 | ✅                         | GDPR hard-delete (PR #16, NFR9 audit-continuity proven by real JOIN test).         |
| T-016 | 🟡 **in flight** (this PR) | WorkOS webhook routing (signature → dedup → 3 application handlers).               |
| T-014 | ⏳                         | Handlers: HTTP routes (depends on the application-layer fan-out below).            |
| T-015 | ⏳                         | Session middleware + `/me` (depends on T-014).                                     |
| T-017 | ⏳                         | Minimal web shell (login / signup / MFA / `/me`).                                  |
| T-018 | ⏳                         | Observability (logs / metrics / alerts).                                           |
| T-020 | ⏳                         | Rate limiting + NFR hardening.                                                     |
| T-021 | ⏳                         | Playwright acceptance suite.                                                       |
| T-022 | ⏳                         | Slice sign-off + traceability matrix + tag.                                        |

## Recommended next pick after T-016 merges

The webhook surface is wired. Next-up is the user-facing HTTP
surface:

1. **T-014 (HTTP handlers)** — wires the application layer to
   API Gateway for the user-facing routes (`/auth/*`, `/orgs/*`,
   `/me`). Authorization gates live here ("signed in + some role");
   the application layer assumes them. Largest task in the slice.
2. **T-015 (session middleware + `/me`)** — depends on T-014; adds
   the cookie-validation middleware and the `/me` shape that the
   web shell consumes.
3. **T-017 (web shell)** — minimal Next.js pages + AuthKit
   redirects; the functional gate before Playwright e2e.
4. **T-018 (observability)** — parallelisable with T-014/T-015/T-017.
5. **T-020 (rate limiting + NFR hardening)** — parallelisable.
6. **T-021 (Playwright e2e)** — depends on T-017.
7. **T-022 (slice sign-off + tag)** — last.

### Faster alternatives if Brad wants a small win first

- **WorkOS event-name investigation for MFA** — figure out which
  real WorkOS events should drive `handleMfaEnrolled` /
  `handleRecoveryCodeUsed`. May need an SDK upgrade or
  `user.updated` mfaFactors-transition logic. Small focused PR.
- **`lookupUserOrAuditFailureForWebhook` helper** — now 5
  callers, 4 user-keyed. Genuinely warranted; small refactor PR.
- Extract `revokeAllActiveSessions` helper (suspension +
  password-reset).
- Extract `AUDIT_REASONS` constants for the stringly-typed
  `metadata.reason` literals across password-reset, mfa,
  invitations, deletion.
- Add `listAuthFactors` to the WorkOS wrapper + swap the
  `isMfaPresent` default in signup/login (per sticky #15).

## Pending follow-ups (not blocking, but worth doing soon)

1. **Multi-write transaction wrapping** — `application/signup.ts`
   today does three writes (user / org / membership) outside any
   transaction. If membership-insert fails, we orphan an org. The
   T-007 repos accept a `Db`; they need to also accept a
   `PgTransaction` so callers can wrap sequences in
   `db.transaction(async (tx) => { ... })`. Touches all six repos
   plus their integration tests. Bounded scope (~half a day).
   Prerequisite for T-009 (invitations) and T-019 (hard-delete) to
   land cleanly.
2. **`AuthFlowError` generic** — `SignupError`, `LoginError`,
   `SuspensionError`, `PasswordResetRequestError`,
   `PasswordResetCompletionError` are nearly identical class shells.
   Could extract a generic `AuthFlowError<R extends string>` to
   `application/_errors.ts`. Touches five files for ~15 LOC savings
   — low priority but clean if a future task is in the
   neighbourhood.
3. **`revokeAllActiveSessions` helper** — see "Deliberately not
   done in this PR" above.
4. **Shared application-test fixtures** — see same.

## Sticky knowledge — kept across handoffs

1. **Drizzle 0.30+ moved bookkeeping into a `drizzle` schema.**
   Reset logic must drop both `public` and `drizzle` (or truncate
   `drizzle.__drizzle_migrations`).
2. **SST component-name typos only surface at deploy time**
   (`sst.aws.*` is `any` in the ambient shim). Always
   `bun sst diff --stage <dev>` before pushing infra changes.
3. **Don't pre-declare future-slice secrets.** SST refuses to
   deploy if any declared secret is unset.
4. **Local docker-compose is `ai-data-room-test-db`-prefixed** to
   avoid colliding with FDP's compose stack.
5. **`bun run test`, not `bun test`.** Bun's built-in runner
   doesn't support our Vitest setup. Note `bun run test` requires
   `sst shell` (AWS creds); `bunx vitest run <pattern>` is the
   no-creds local fast path.
6. **`.claude/` is gitignored + prettier-ignored.**
7. **Migration naming**: drizzle-kit emits
   `0001_<random_nouns>.sql`; we rename to `0001_<intent>.sql`
   and update the `tag` in `meta/_journal.json`.
8. **Hand-edited migrations** — pair every hand-touched `*.sql`
   with a `*.down.sql` outside the migrations folder drizzle reads.
9. **WorkOS SDK names** — `userManagement.sendInvitation` (not
   `createInvitation`), `userManagement.createPasswordReset` (no
   `sendPasswordResetEmail` method). The wrapper at
   `infrastructure/workos/client.ts` bridges them.
10. **WorkOS webhooks need a synthetic clientId** —
    `new WorkOS({})` throws; PKCE-mode
    `new WorkOS({ clientId: ... })` is the workaround for
    signature-verification-only paths.
11. **Repos use `firstOrNull` for "select-one or null" and
    `firstOrThrow` for "update-must-find-row"** —
    `_helpers.ts` is the single home.
12. **AuditRepo cursor is composite `(occurredAt, id) < (cursor)`**
    — the id half is load-bearing for events sharing a millisecond.
13. **All audit writes go through
    `application/audit.ts#recordAuditEvent`**, never
    `AuditRepo.write` directly. Validates the canonical shape +
    strips NFR8 forbidden material.
14. **`safeAudit` in `application/_audit-context.ts`** — every
    application-layer auth flow uses this so an audit-write
    failure doesn't mask the real outcome.
15. **MFA-presence check is pluggable via `deps.isMfaPresent`** —
    default trusts AuthKit; T-010 will swap in a stricter check
    once `listAuthFactors` is added to the WorkOS wrapper.
16. **Multi-write transactions are NOT yet wired in any
    application function.** Signup orphans an org if membership
    create fails; same risk for any future multi-write flow. See
    "Pending follow-ups" above.
17. **Login resolves WorkOS org id → local UUID via
    `orgRepo.findByWorkosOrgId`** — `session.organizationId` is
    the WorkOS-side text id, NOT our local UUID. Bug Cursor caught
    on PR #9.
18. **Signup stamps `mfaEnrolledAt` + `emailVerifiedAt` at
    create-time** (T-007's `CreateUserInput` was extended).
    Without this, fresh signups would fail their first login on
    the FR16 MFA gate. Bug Cursor caught on PR #9.
19. **Suspension revokes WorkOS sessions BEFORE flipping local
    lifecycle.** The spec's "timing test" asserts this ordering
    via `mock.invocationCallOrder`. A revoke failure leaves our
    DB consistent — better than the opposite.
20. **`WorkOSClient.listSessions(userId)` auto-paginates** —
    returns a flat `Session[]`. T-011 reuses this for the
    revoke-all-on-completion path.
21. **Cursor Bugbot has caught real bugs on every PR with
    multi-step or external-ID flows.** Always read its findings
    before merging; if it flags something, write a regression
    test that proves the fix before pushing.
22. **Authorization (only owner / admin can X) is a handler-layer
    concern (T-014).** Application functions enforce data
    invariants only — self-suspension, sole-owner protection,
    schema validation. Don't put role checks in
    `application/*.ts`.
23. **`requestPasswordReset` deliberately skips a local
    `findByEmail` lookup** — it would leak account existence via
    timing differences (DB hit vs miss) and add no functional
    value (WorkOS is the source of truth). T-011's file header
    documents this.
24. **`requestPasswordReset` swallows the WorkOS error message
    entirely**, including from the audit metadata — only a generic
    `reason: "delegate_error"` is written. WorkOS error strings
    differ between known/unknown emails; if any of them ever leak
    to the response or to a downstream consumer of the audit,
    enumeration becomes possible. Tests pin the audit metadata to
    a closed shape (not `objectContaining`) to catch a future
    field-addition leak.
25. **`handlePasswordResetCompleted` returns null on
    `user_not_found` rather than throwing** — webhooks must be
    redeliverable; a throw would force WorkOS into a permanent
    retry loop for an event we'll never act on.
26. **`Promise.all` vs `Promise.allSettled` choice is
    flow-dependent.** Suspension uses `Promise.all` (revoke
    failure must skip the lifecycle flip). Password-reset
    completion uses an `allSettled`-style per-task try/catch so
    every revoke runs even when one fails — the audit row carries
    `{ attempted, succeeded, failed }` for forensics. Both are
    intentional; copy whichever matches the new flow's semantics.
27. **Recovery codes are entirely owned by AuthKit per ADR-003.**
    Plaintext codes never enter our system. The
    `getRecoveryCodesForDownload` method the original T-010 spec
    mentioned is intentionally NOT implemented. FR17(c)
    (regenerate) is a deferred follow-up.
28. **`mfa_enrolled` webhook handler always re-mirrors
    `users.mfa_enrolled_at` even on redelivery** — no idempotency
    guard. The DB write is cheap and webhook redeliveries are
    rare; a guard would add branch + test for negligible win.
    Audit dedup is the webhook routing layer's job (T-016).
29. **Recovery-code-used audit metadata is closed-shape `{}`** by
    contract (ADR-003 follow-up #4). The unit test pins this with
    `toEqual({})` not `objectContaining` — any future regression
    that adds an `id` / `codeHash` / `code` field breaks it on
    purpose. Defence-in-depth on top of the NFR8 strip.
30. **Multi-write transactions use the `withTx(tx)` factory
    pattern.** Every T-007 repo accepts `DbOrTx` in its
    constructor and exposes `withTx(tx: Tx): ThisRepo`. Application
    functions take a `db: Db` dep and call
    `db.transaction(async (tx) => { repo.withTx(tx).create(...) })`
    so a mid-sequence failure rolls every write back. **Awaits
    inside the callback MUST stay sequential** — Drizzle's `tx`
    handle wraps a single Postgres connection, so concurrent
    awaits interleave commands and risk
    `another command is already in progress`. signup.ts is the
    template; T-009 and T-019 will copy this shape.
31. **Audit writes deliberately stay OUTSIDE the caller's
    transaction.** `safeAudit` is called after `db.transaction`
    resolves, on purpose: an audit-write failure shouldn't roll
    business state back, and a transaction rollback shouldn't
    erase the audit row of the failure we wanted to record.
    `AuditRepo` does still have a `withTx` for the rare case a
    caller wants in-tx audit, but signup.ts shows the standard
    pattern.

## Workflow conventions in one paragraph

Branch off `main` per task (`feat/<slice>-T-XXX-<short-desc>`),
one task one PR. Run the full guard set locally before pushing.
Write the simplify-skill review **after** tests pass and **before**
committing — it has caught real wins on every recent PR. Cursor
Bugbot runs on every PR and has caught real bugs on every flow
with external IDs or multi-step ordering. Tasks.md ticks `[~]`
mid-PR and `[x]` after merge. HANDOFF.md is rewritten at every
transition; if you finish a task and there's no next one in
flight, this file gets the brief for the next pickup.
