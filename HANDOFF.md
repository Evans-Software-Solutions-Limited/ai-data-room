# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-05 by Claude Code, post-T-014a merge. No
task currently in flight — branch is clean, `main` is the head
everywhere. T-014a (public auth routes) merged as PR #19; T-016
(WorkOS webhook routing) merged earlier as PR #17.

## Where we are in slice 1 (auth-and-orgs)

The webhook surface AND the public auth surface are wired. The
remaining work is the protected-routes side of the HTTP layer +
observability + e2e + sign-off. Slice 1 is **~90% done by task
count**.

| Task   | Status      | Notes                                                                              |
| ------ | ----------- | ---------------------------------------------------------------------------------- |
| T-001  | ✅          | Repo scaffold.                                                                     |
| T-002  | ✅          | WorkOS + secrets wiring (PR #1).                                                   |
| T-003  | ✅          | Postgres + Drizzle setup (PR #3).                                                  |
| T-004  | ✅          | Domain types + zod schemas (PR #4).                                                |
| T-005  | ✅          | Postgres-specific DDL augments (PR #5).                                            |
| T-006  | ✅          | WorkOS client wrapper + webhook verifier (PR #6).                                  |
| T-007  | ✅          | Typed Drizzle repositories (PR #7).                                                |
| T-013  | ✅          | Application-layer audit event writer (PR #8).                                      |
| T-008  | ✅          | Signup + login callback flows (PR #9). **NB: currently unwired, see follow-ups.**  |
| T-012  | ✅          | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).                       |
| T-011  | ✅          | Password reset (PR #12).                                                           |
| T-010  | ✅          | MFA enrolment + recovery-code-used audit (PR #13, scope trimmed by ADR-003).       |
| –      | ✅          | Chore: repos accept `Db \| PgTransaction` + signup wraps multi-write (PR #14).     |
| T-009  | ✅          | Application: invitations (PR #15, 4 functions incl. multi-write acceptInvitation). |
| T-019  | ✅          | GDPR hard-delete (PR #16, NFR9 audit-continuity proven by real JOIN test).         |
| T-016  | ✅          | WorkOS webhook routing + dedup ledger (PR #17).                                    |
| T-014a | ✅          | Public auth routes (sign-in / sign-up / callback / sign-out) (PR #19).             |
| T-014b | 🎯 **next** | Protected routes (invitations / suspend / unsuspend / audit-events) + `/me`.       |
| T-015  | 🎯 **next** | Session middleware + `requireAuth` guard (bundled with T-014b — they're coupled).  |
| T-017  | ⏳          | Minimal web shell (login / signup / MFA / `/me`).                                  |
| T-018  | ⏳          | Observability (logs / metrics / alerts).                                           |
| T-020  | ⏳          | Rate limiting + NFR hardening.                                                     |
| T-021  | ⏳          | Playwright acceptance suite.                                                       |
| T-022  | ⏳          | Slice sign-off + traceability matrix + tag.                                        |

## Next pickup: T-015 + T-014b (bundled)

### Why bundled

Per the FDP precedent followed in T-014a: session middleware and
protected routes are tightly coupled — middleware is pointless
without protected routes that exercise it, and protected routes
can't be tested without the middleware that mints the auth
context. FDP ships them as a single `protectedRoutes.ts` bundle
behind `.resolve(requireAuth)`. We do the same.

### What this PR ships

**Middleware** (`microservices/core/src/application/auth/guards/`):

- `requireAuth.ts` — Elysia `.resolve()` guard. Reads
  `wos_session` cookie → `loadSealedSession().authenticate()` →
  `.refresh()` if expired (sets new cookie) → returns
  `{ user, organizationId }` into context. Returns `status(401)`
  to short-circuit the request on missing / invalid / expired
  session.
- `requireOrg.ts` — Elysia `.onBeforeHandle()` guard. Returns
  403 if `organizationId` is missing from the resolved context
  (e.g. external user with no org). Optional gate so routes that
  only need authentication can opt out.
- `resolveActor.ts` (new) — Elysia `.resolve()` that maps
  `user.id` (WorkOS-side) → local `users.id` (UUID) and
  `organizationId` (WorkOS-side text id) → local
  `organizations.id` (UUID) via `userRepo.findByWorkosUserId` +
  `orgRepo.findByWorkosOrgId`. Application functions take local
  UUIDs; the handler layer can't pass WorkOS IDs through. Has to
  handle the **fresh-signup race** — see "Open question" below.

**Protected route handlers**
(`microservices/core/src/application/auth/`):

- `user/getUserHandler.ts` — `GET /me` (FR14). Reads context,
  returns the documented `/me` shape.
- `invitations/postInvitationsHandler.ts` — `POST /orgs/:orgId/invitations`. Wraps `createInvitation` (T-009).
- `invitations/getInvitationsHandler.ts` — `GET /orgs/:orgId/invitations`. Wraps `listInvitations`.
- `invitations/deleteInvitationHandler.ts` — `DELETE /orgs/:orgId/invitations/:id`. Wraps `revokeInvitation`.
- `users/postSuspendHandler.ts` — `POST /orgs/:orgId/users/:userId/suspend`. Wraps `suspendUser` (T-012).
- `users/postUnsuspendHandler.ts` — `POST /orgs/:orgId/users/:userId/unsuspend`. Wraps `unsuspendUser`.
- `audit-events/getAuditEventsHandler.ts` — `GET /orgs/:orgId/audit-events`. Wraps `auditRepo.listByOrg` (no application function — read-only thin pass-through).
- `protectedRoutes.ts` — Elysia bundle:
  `.resolve(requireAuth).onBeforeHandle(requireOrg).resolve(resolveActor).use(getUserHandler).use(...)`.

**Wiring** in `microservices/core/src/api.ts` — add
`.use(protectedRoutes)`.

### Recommended scope

- All of the above in **one PR** (~700-1000 LOC + ~600-800 tests).
  Coherent feature, mirrors the FDP shape. Split would force the
  next agent to re-grok the same context.
- Bigger than T-014a (4 handlers) but each protected handler is
  ~30 LOC. Bulk is in `requireAuth` + `resolveActor` (~150 LOC
  combined) + middleware tests.

### Open question — the fresh-signup race

T-014a's callback handler is intentionally thin: validates state,
exchanges code, sets sealed cookie, redirects. It does NOT mirror
the local `users` row. The webhook flow on `user.created` was the
intended source-of-truth path, **but T-016 currently acks
`user.created` as `ignored: true`** — that handler isn't wired
yet either.

So a fresh sign-up today produces: ✅ WorkOS user, ✅ sealed
session cookie, ❌ no local `users` row, ❌ no local
`organizations` row, ❌ no local `org_memberships` row. The web
client hits `/me`, `resolveActor` calls
`userRepo.findByWorkosUserId(workosUserId)` → null, and we have
to do something.

Three options to weigh:

- **(A) Lazy mirror in `resolveActor`.** First `/me` call
  triggers a find-or-create on the user (no org / no membership).
  Returns a partial `/me` shape with `organizationId: null`.
  Subsequent calls hit the existing row.
- **(B) Wire `user.created` in T-016**'s webhook router (small
  follow-up). Lazy in resolveActor stays: if mirror missing,
  return 503 "still provisioning" with a Retry-After header.
  Web client polls.
- **(C) Inline-mirror in callback.** Move the user/org/membership
  insert from the webhook idea into the callback handler (use
  T-008's `handleSignup` after refactoring it to take an
  `AuthenticationResponse` instead of a `workosCode`).

**Recommendation (A) for v0.1 — lazy mirror.** Webhook flow is
async and a 503-then-retry UX is awful for first-time signup.
Lazy mirror makes the user visible by the time the redirect
target loads. Takes the org-creation question off the table for
this PR (org provisioning lands in `onboarding-flow` or as a
follow-up form-driven step).

T-008's `handleSignup` and `handleLoginCallback` stay as
deadcode-ish until either retired or reshaped. Not ideal but it's
the smallest thing that ships T-014b cleanly.

### Patterns to mirror (from PRs already merged)

- **`application/auth/sign-in/getSignInHandler.ts`** —
  one-handler-per-file shape.
- **`application/auth/_shared/createAuthRedirectHandler.ts`** —
  factory pattern for routes that share 90%+ logic. Each
  protected handler is structurally similar (validate input →
  call application function → translate result), so a similar
  factory might be worth extracting after the third one.
- **`application/auth/__tests__/publicRoutes.test.ts`** —
  `vi.doMock("sst") + vi.resetModules()` test pattern. Use the
  same shape for the protected route tests; add a
  `mockAuthContext` helper that pre-fills the
  `requireAuth`-resolved context.
- **FDP's `protectedRoutes.ts`** at
  `~/Documents/projects/funds-distribution-platform/microservices/core/src/application/auth/protectedRoutes.ts`
  is the canonical example for the `.resolve().onBeforeHandle().use(...)`
  bundle. Don't copy the FDP-specific `resolveTenant` middleware —
  we're single-tenant for v0.1.

### Things to think about up front

1. **The `setSecureCookie` helper in `config/frontendUrl.ts`**
   already exists — use it for the refreshed `wos_session` cookie
   on session refresh inside `requireAuth`. Don't reinvent the
   cookie-options block.
2. **The `client_init_failed` vs `auth_failed` split** Bugbot
   caught on PR #19 — protected routes' middleware will hit the
   same shape. Keep server-config errors (500) distinct from
   user-auth errors (401) in `requireAuth`.
3. **Authorization rules** belong at the handler layer per
   sticky #22. The application functions enforce data invariants
   only (self-suspension, sole-owner-protection, etc.). The
   protected handlers must check actor role before calling the
   application function — e.g. only owner/admin can revoke an
   invitation.
4. **Cross-org guards** like the one Bugbot caught on
   `revokeInvitation` (sticky #30) — the application function
   already enforces `invitation.orgId === input.orgId`, but the
   handler should ALSO validate `params.orgId` matches the
   actor's resolved org context. Defence in depth.
5. **The `/me` shape** is documented in
   `specs/ai-data-room/auth-and-orgs/design.md` §`GET /me
response shape`. Pin a closed-shape response schema via Elysia
   `t.Object` so a future field addition forces a deliberate
   contract update.

### Faster alternatives if Brad wants a small win first

- **Land just `requireAuth` + `/me`** (drop the protected route
  handlers from this PR). Smallest unit that proves the session
  middleware works end-to-end.
- **Wire `user.created` webhook handler** in T-016's router
  (small follow-up). Removes the fresh-signup race from
  resolveActor's lap.
- **`lookupUserOrAuditFailureForWebhook` helper** — 5 callers
  now, genuinely earned.
- **WorkOS event-name investigation for MFA** — figure out which
  real WorkOS events should drive `handleMfaEnrolled` /
  `handleRecoveryCodeUsed`.

## Pending follow-ups (not blocking, but worth doing soon)

1. **T-008's `handleSignup` and `handleLoginCallback` are
   unwired.** They take `workosCode` as input and call
   `authenticateWithCode` themselves. T-014a's thin callback
   pattern doesn't use them. Decision deferred to T-015 / T-014b:
   either retire (the lazy-mirror path covers the same
   responsibility) or reshape to take an `AuthenticationResponse`
   for use from a future `user.created` webhook handler.
2. **`AuthFlowError` generic** — `SignupError`, `LoginError`,
   `SuspensionError`, `PasswordResetRequestError`,
   `PasswordResetCompletionError`, `InvitationError` are nearly
   identical class shells. Could extract a generic
   `AuthFlowError<R extends string>`.
3. **`revokeAllActiveSessions` helper** — `password-reset.ts`
   and `suspension.ts` have identical
   list-then-filter-then-fan-out blocks.
4. **Shared application-test fixtures** — `makeUser` /
   `makeSession` / `makeOrg` etc. duplicate across 8+ test files.
5. **`scripts/manual-gdpr-delete.ts`** — referenced in
   `ops/runbooks/gdpr-delete.md` as the WorkOS-down fallback.
   Doesn't exist yet; flagged as Phase 2.
6. **MFA application handler wiring** —
   `handleMfaEnrolled` and `handleRecoveryCodeUsed` exist but
   aren't reachable by any webhook (T-016 acks the relevant
   event types as ignored). Wire once the WorkOS event-name
   investigation lands.
7. **`session.revoked` cache bust** — webhook acks the event
   but doesn't bust a session cache (which doesn't exist —
   sealed sessions have no shared cache to bust). The note can
   be removed from the codebase once T-015 confirms.
8. **`AUDIT_REASONS` constants** — stringly-typed
   `metadata.reason` literals across 4 application files.
9. **`lookupUserOrAuditFailureForWebhook` helper** — 5 webhook
   callers now (password-reset, mfa-enrolled,
   recovery-code-used, accept-invitation, deletion). Genuinely
   warranted; cross-aggregate refactor PR.
10. **`sst-env.d.ts` + `infra/api.ts` — production FRONTEND_URL.**
    Currently hardcoded as `https://web.ai-data-room.example`
    for non-`$dev` stages. Swap to the real domain when the web
    app gets one.
11. **PR #18 (the prior post-T-016 HANDOFF refresh) was
    superseded** by this refresh and closed without merging.
    Anything in this file is the current state of project memory.

## Sticky knowledge — kept across handoffs

1. **Drizzle 0.30+ moved bookkeeping into a `drizzle` schema.**
   Reset logic must drop both `public` and `drizzle` (or
   truncate `drizzle.__drizzle_migrations`).
2. **SST component-name typos only surface at deploy time**
   (`sst.aws.*` is `any` in the ambient shim). Always
   `bun sst diff --stage <dev>` before pushing infra changes.
3. **Don't pre-declare future-slice secrets.** SST refuses to
   deploy if any declared secret is unset.
4. **Local docker-compose is `ai-data-room-test-db`-prefixed**
   to avoid colliding with FDP's compose stack.
5. **`bun run test`, not `bun test`.** Bun's built-in runner
   doesn't support our Vitest setup. Note `bun run test`
   requires `sst shell` (AWS creds); `bunx vitest run <pattern>`
   is the no-creds local fast path.
6. **`.claude/` is gitignored + prettier-ignored.**
7. **Migration naming**: drizzle-kit emits
   `0001_<random_nouns>.sql`; we rename to `0001_<intent>.sql`
   and update the `tag` in `meta/_journal.json`.
8. **Hand-edited migrations** — pair every hand-touched `*.sql`
   with a `*.down.sql` outside the migrations folder drizzle
   reads.
9. **WorkOS SDK names** — `userManagement.sendInvitation` (not
   `createInvitation`), `userManagement.createPasswordReset`
   (no `sendPasswordResetEmail` method). The wrapper at
   `infrastructure/workos/client.ts` bridges them.
10. **WorkOS webhooks need a synthetic clientId** —
    `new WorkOS({})` throws; PKCE-mode
    `new WorkOS({ clientId: ... })` is the workaround for
    signature-verification-only paths.
11. **Repos use `firstOrNull` for "select-one or null" and
    `firstOrThrow` for "update-must-find-row"** —
    `_helpers.ts` is the single home.
12. **AuditRepo cursor is composite `(occurredAt, id) <
(cursor)`** — the id half is load-bearing for events
    sharing a millisecond.
13. **All audit writes go through
    `application/audit.ts#recordAuditEvent`**, never
    `AuditRepo.write` directly.
14. **`safeAudit` in `application/_audit-context.ts`** — every
    application-layer auth flow uses this so an audit-write
    failure doesn't mask the real outcome.
15. **MFA-presence check is pluggable via `deps.isMfaPresent`**
    — default trusts AuthKit; investigation deferred until
    WorkOS event-name mapping is settled.
16. **Multi-write transaction wrapping uses the `withTx(tx)`
    factory pattern.** Every T-007 repo accepts `DbOrTx` and
    exposes `withTx(tx: Tx): ThisRepo`. Application functions
    call
    `db.transaction(async (tx) => repo.withTx(tx).create(...))`.
    **Awaits inside the txn callback MUST stay sequential** —
    Drizzle's tx handle wraps a single Postgres connection.
17. **Login resolves WorkOS org id → local UUID via
    `orgRepo.findByWorkosOrgId`** — `session.organizationId` is
    the WorkOS-side text id, NOT our local UUID. Bug Cursor
    caught on PR #9.
18. **Signup stamps `mfaEnrolledAt` + `emailVerifiedAt` at
    create-time**. Without this, fresh signups would fail their
    first login on the FR16 MFA gate. Bug Cursor caught on PR
    #9.
19. **Suspension revokes WorkOS sessions BEFORE flipping local
    lifecycle.** A revoke failure leaves our DB consistent.
20. **`WorkOSClient.listSessions(userId)` auto-paginates** —
    returns a flat `Session[]`.
21. **Cursor Bugbot has caught real bugs on every PR with
    multi-step or external-ID flows.** Always read its findings
    before merging; if it flags something, write a regression
    test that proves the fix before pushing.
22. **Authorization (only owner / admin can X) is a handler-
    layer concern (T-014).** Application functions enforce data
    invariants only — self-suspension, sole-owner protection,
    schema validation. Don't put role checks in
    `application/*.ts`. Exception: invitations.ts enforces the
    `actorRole`-vs-`invitationRole` rule because it's a
    domain-specific permission.
23. **`requestPasswordReset` deliberately skips a local
    `findByEmail` lookup** — would leak account existence via
    timing.
24. **`requestPasswordReset` swallows the WorkOS error message
    entirely** — only a generic `reason: "delegate_error"` lands
    in the audit. Tests pin the audit metadata to a closed shape
    (`toEqual`, not `objectContaining`).
25. **Webhook handlers return null on lookup-miss rather than
    throwing** — webhooks must be redeliverable.
26. **`Promise.all` vs `Promise.allSettled` choice is
    flow-dependent.** Suspension uses `Promise.all` (revoke
    failure must skip the lifecycle flip). Password-reset
    completion uses an `allSettled`-style per-task try/catch so
    every revoke runs even when one fails.
27. **Recovery codes are entirely owned by AuthKit per ADR-003.**
    Plaintext codes never enter our system.
28. **Recovery-code-used audit metadata is closed-shape `{}`**
    by contract.
29. **Invitation state transitions use atomic compare-and-set
    (`InvitationRepo.transitionState`)** — closes TOCTOU races.
    Without this, `external_access_grants` could end up with
    duplicate rows. Bug Bugbot caught on PR #15.
30. **Cross-org tenancy guard on `revokeInvitation`** — handler
    validates actor's role in `input.orgId`; application
    function checks `invitation.orgId === input.orgId` and
    treats mismatch as not-found. Bug Bugbot caught on PR #15.
31. **Webhook routing dedups via the `webhook_deliveries`
    table** keyed on the WorkOS event id. `INSERT ... ON
CONFLICT DO NOTHING` is the load-bearing primitive. App
    handlers stay independently idempotent for state but emit
    `failure / already_*` audit on redelivery — dedup at the
    routing layer is required for the spec's "exactly one audit
    row" guarantee.
32. **Webhook handlers split: routing logic in `workos.ts` (in
    coverage gate) + Lambda wrapper in `workosLambda.ts`
    (excluded from gate, mirrors `src/api.ts`).** Production
    wires deps from `Resource.*` + `getDb()` + binds application
    handlers to `(input) => result` routes.
33. **WorkOS event names ≠ design.md event names.** v8.13 SDK
    does NOT expose `authentication.mfa_enrolled` or
    `authentication.recovery_code_used` as discriminated event
    types. T-016 acks these as `{ ignored: true }`; the
    application handlers exist but aren't reachable.
34. **API Gateway HTTP API v2 lowercases all header names**
    before invoking the Lambda. No need for TitleCase fallbacks.
35. **Webhook handler 500-response bodies omit error messages**
    — WorkOS surfaces response bodies in its delivery log, and
    pg-driver errors can include connection strings or stack
    frame paths. The full error is `console.error`'d for
    forensics.
36. **Webhook dedup ordering: insert-then-route, NOT
    route-then-insert.** Trade-off: an application-handler
    exception leaves the dedup row in place, so WorkOS retries
    will short-circuit to replay rather than re-execute. Manual
    operator recovery is `DELETE FROM webhook_deliveries WHERE
event_id = '…'` followed by re-trigger.
37. **`migrate.integration.test.ts` `EXPECTED_TABLES` is
    exact-match.** Adding any new table to `schema/auth.ts`
    requires a one-line update to that array, otherwise the
    smoke test fails on count mismatch.
38. **`sst-env.d.ts` is auto-generated by SST but committed.**
    If a new secret is declared in `infra/secrets.ts` between
    SST runs, the type entry won't appear until `bun sst dev`
    regenerates. The pattern is a manual edit with a `// MANUAL
ENTRY (T-NNN)` marker; the next regen overwrites cleanly.
39. **FDP layout for HTTP handlers: `application/auth/<route>/`**
    — one handler per nested directory, two route bundles
    (`publicRoutes.ts` + `protectedRoutes.ts` next), one shared
    config helper at `config/frontendUrl.ts`. Deliberately NOT
    under `handlers/` (the existing
    `handlers/auth/healthWorkosGetHandler.ts` is the outlier).
40. **`setSecureCookie` in `config/frontendUrl.ts` is the
    sanctioned way to set cookies.** Centralises the four
    invariant attributes (`HttpOnly`, `Secure`, `SameSite`,
    `path`) so adding a new cookie can't accidentally drop one
    of them. Use it from `requireAuth` for the refreshed
    session cookie too.
41. **Web Crypto + `globalThis.process` shim for browser-safe
    type graph.** The `CoreApi` type leaks into `packages/web`
    via Eden Treaty, and web's tsconfig doesn't include
    `@types/node`. Use `crypto.randomUUID()` instead of
    `node:crypto`'s `randomBytes`; access env vars via
    `globalThis.process` (see `frontendUrl.ts`'s
    `NodeProcessLike` declaration).
42. **`createWorkOSClient` is constructed at request scope, not
    module load.** The pattern enforces `vi.doMock("sst") +
vi.resetModules() + dynamic import` testability. FDP
    constructs at module load; we deliberately diverge.
43. **`client_init_failed` vs `auth_failed` (callback handler).**
    Server-config errors get 500 + `client_init_failed`;
    user-auth errors (bad/expired code) get 401 + `auth_failed`.
    Two distinct try/catch blocks. Lumping them is a Bugbot
    finding (PR #19) — the conflated catch misled both
    client-side error UX and ops dashboards.
44. **Sealed sessions have no separate cache.** AuthKit's
    sealed-session JWKS validation is fast enough on warm
    Lambdas (the SDK caches JWKS internally) that the design
    doc's "60s LRU cache" plan is stale. T-015 should NOT add
    one. The cookie blob IS the session state.
45. **Callback handler is intentionally thin.** Validates state,
    exchanges code, sets sealed cookie, redirects. Does NOT
    mirror the local `users` row — that's deferred to a
    `user.created` webhook handler (not yet wired) or to lazy
    mirror in `resolveActor` (recommended for T-015). T-008's
    `handleSignup` / `handleLoginCallback` application functions
    are currently unwired.
46. **`infra/api.ts` env vars vs `Resource.*` for URLs.** We
    pass `FRONTEND_URL` and `API_URL` as Lambda env vars (set in
    `infra/api.ts`) rather than via `Resource.web.url` /
    `Resource["api-core"].url` because:
    - Linking `web` into the core API Lambda would create a
      circular SST dependency (`infra/web.ts` already imports
      `coreAPI`).
    - `API_URL` self-references `coreAPI.url` which SST resolves
      lazily — works fine.
    - `FRONTEND_URL` is hardcoded for non-`$dev` stages until
      the web app gets a real domain.

## Workflow conventions in one paragraph

Branch off `main` per task (`feat/<slice>-T-XXX-<short-desc>`),
one task one PR. Run the full guard set locally before pushing.
Write the simplify-skill review **after** tests pass and
**before** committing — it has caught real wins on every recent
PR. Cursor Bugbot runs on every PR and has caught real bugs on
every flow with external IDs or multi-step ordering. Tasks.md
ticks `[~]` mid-PR and `[x]` after merge. HANDOFF.md is rewritten
at every transition; if you finish a task and there's no next one
in flight, this file gets the brief for the next pickup.
