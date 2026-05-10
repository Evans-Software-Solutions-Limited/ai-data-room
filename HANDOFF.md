# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-09 by Claude Code, post-T-015 + T-014b
merge. No task currently in flight — branch is clean, `main` is the
head everywhere. T-014b (protected route handlers) and T-015
(session middleware) merged together as PR #21; T-014a (public auth
routes) merged earlier as PR #19.

## Where we are in slice 1 (auth-and-orgs)

The HTTP surface is fully wired. What's left is the user-visible
shell, observability, hardening, e2e, and the slice tag.

| Task   | Status      | Notes                                                                                   |
| ------ | ----------- | --------------------------------------------------------------------------------------- |
| T-001  | ✅          | Repo scaffold.                                                                          |
| T-002  | ✅          | WorkOS + secrets wiring (PR #1). `/_health/workos` deleted in T-015.                    |
| T-003  | ✅          | Postgres + Drizzle setup (PR #3).                                                       |
| T-004  | ✅          | Domain types + zod schemas (PR #4).                                                     |
| T-005  | ✅          | Postgres-specific DDL augments (PR #5).                                                 |
| T-006  | ✅          | WorkOS client wrapper + webhook verifier (PR #6).                                       |
| T-007  | ✅          | Typed Drizzle repositories (PR #7).                                                     |
| T-013  | ✅          | Application-layer audit event writer (PR #8).                                           |
| T-008  | ✅          | Signup + login callback flows (PR #9). **Unwired since T-014a; decide retire/reshape.** |
| T-012  | ✅          | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).                            |
| T-011  | ✅          | Password reset (PR #12).                                                                |
| T-010  | ✅          | MFA enrolment + recovery-code-used audit (PR #13, scope trimmed by ADR-003).            |
| –      | ✅          | Chore: repos accept `Db \| PgTransaction` + signup wraps multi-write (PR #14).          |
| T-009  | ✅          | Application: invitations (PR #15).                                                      |
| T-019  | ✅          | GDPR hard-delete (PR #16).                                                              |
| T-016  | ✅          | WorkOS webhook routing + dedup ledger (PR #17).                                         |
| T-014a | ✅          | Public auth routes — sign-in / sign-up / callback / sign-out (PR #19).                  |
| T-014b | ✅          | Protected routes — /me + invitations CRUD + suspend/unsuspend + audit-events (PR #21).  |
| T-015  | ✅          | Session middleware — `requireAuth` + `resolveActor` + `requireOrg` (PR #21).            |
| T-017  | 🎯 **next** | Minimal web shell (login / signup / MFA / `/me` page).                                  |
| T-018  | ⏳          | Observability — logs / metrics / alerts. Parallelisable with T-017.                     |
| T-020  | ⏳          | Rate limiting + NFR hardening. Parallelisable with T-017.                               |
| T-021  | ⏳          | Playwright acceptance suite. Depends on T-017.                                          |
| T-022  | ⏳          | Slice sign-off + traceability matrix + tag. Last.                                       |

Slice 1 is **~93% done by task count**. The remaining work splits
into two streams: T-017→T-021→T-022 on the critical path to slice
sign-off, and T-018 + T-020 in parallel.

## Recommended next pickup: T-017 — web shell

### Why T-017 first

It's the only remaining item that gates the slice tag:

- T-021 (Playwright e2e) needs T-017 to exist — there's nothing to
  drive a browser through without the pages.
- T-022 (sign-off) needs T-021 to be green to claim slice complete.
- T-018 + T-020 don't gate anything, so they can slot in parallel
  (or after) without delaying the tag.

T-017 also unblocks **slice 9 (`onboarding-flow`)** — the lazy-mirror
`/me` shape now returns `{ role: null, orgId: null, ... }` for
freshly-signed-up users, and the web shell needs to render that
state with a call-to-action that lands a user in slice 9's
"create your org" form once that exists.

### What T-017 ships (per `tasks.md`)

The frontend stack is locked: **Vite + React + React Router 7 +
Eden Treaty + Tailwind**, in the existing `packages/web` workspace.
Spec docs were amended in PR #22 to match.

Minimal routes added to `packages/web/src/pages/`:

- `Login.tsx` — redirects to `GET /auth/sign-in` (which then
  redirects to AuthKit). Polish lives in `onboarding-flow`.
- `Signup.tsx` — redirects to `GET /auth/sign-up`.
- `Logout.tsx` — calls `POST /auth/sign-out` and redirects.
- `App.tsx` (or `Me.tsx`) — fetches `GET /me` via Eden Treaty,
  shows the payload, plus a logout button. Renders the
  unprovisioned shape (`role: null`, `orgId: null`) with a
  placeholder for the slice-9 onboarding flow.
- `Mfa.tsx` — recovery-codes download UI for fresh enrolment
  (T-010 shipped the API; T-017 wires the front end).

Plus the route table in `packages/web/src/App.tsx` mounting them.

DoD: every `AC-US*` from `requirements.md` is reachable end-to-end
in a browser. Tests required: Playwright coverage for AC-US1
through AC-US11 (the suite itself lands in T-021).

### Faster alternatives if Brad wants to ship something else first

- **T-018 (observability)** — pino structured logs + CloudWatch EMF
  metrics + a small set of alerts. No web work; pure infra +
  middleware. Can land while the T-017 spec question gets resolved.
- **T-020 (rate limiting + NFR hardening)** — API Gateway IP-based
  - per-handler email-based limits. Mostly infra config.
- **Retire or reshape T-008's `handleSignup` / `handleLoginCallback`**
  — they've been deadcode since T-014a. Either delete them (the
  lazy-mirror in `resolveActor` covers the same responsibility for
  v0.1) or reshape to take an `AuthenticationResponse` so a future
  `user.created` webhook handler can call them. ~30-min cleanup PR.
- **Wire `user.created` webhook handler** — currently
  `ignored: true` in `routeWorkOSWebhook`. With lazy-mirror in
  place this isn't load-bearing for v0.1, but a defensive backfill
  for out-of-band WorkOS-side user creates would close a small gap.
  Small focused PR, ~1 hour.
- **WorkOS event-name investigation for MFA** — figure out which
  real events drive `handleMfaEnrolled` / `handleRecoveryCodeUsed`
  (sticky #21 below).

## Pending follow-ups (not blocking, but worth doing soon)

1. **T-008's `handleSignup` and `handleLoginCallback` are unwired.**
   They take `workosCode` as input and call `authenticateWithCode`
   themselves. T-014a's thin callback pattern doesn't use them, and
   the lazy-mirror in `resolveActor` covers the user-row-creation
   responsibility for organic signup. Decide: retire (delete +
   remove from exports) or reshape for a future `user.created`
   webhook path. Lean toward retire — webhook flow has a real
   sub-second race between callback redirect and webhook fire that
   lazy-mirror sidesteps cleanly.
2. **`AuthFlowError` generic** — `SignupError`, `LoginError`,
   `SuspensionError`, `PasswordResetRequestError`,
   `PasswordResetCompletionError`, `InvitationError` are nearly
   identical class shells (the post-erasable-syntax-sweep field-decl
   form is even more boilerplate). Could extract a generic
   `AuthFlowError<R extends string>` to `application/_errors.ts`.
3. **`revokeAllActiveSessions` helper** — `password-reset.ts` and
   `suspension.ts` have identical list-then-filter-then-fan-out
   blocks.
4. **Shared application-test fixtures** — `makeUser` / `makeSession`
   / `makeOrg` etc. duplicate across 8+ test files.
5. **`scripts/manual-gdpr-delete.ts`** — referenced in
   `ops/runbooks/gdpr-delete.md` as the WorkOS-down fallback;
   doesn't exist yet. Phase 2.
6. **MFA application handler wiring** — `handleMfaEnrolled` and
   `handleRecoveryCodeUsed` exist but aren't reachable by any
   webhook (T-016 acks the relevant event types as `ignored`).
   Wire once the WorkOS event-name investigation lands.
7. **`AUDIT_REASONS` constants** — stringly-typed `metadata.reason`
   literals across 4 application files.
8. **`lookupUserOrAuditFailureForWebhook` helper** — 5 webhook
   callers now (password-reset, mfa-enrolled, recovery-code-used,
   accept-invitation, deletion). Genuinely warranted; cross-aggregate
   refactor PR.
9. **`sst-env.d.ts` + `infra/api.ts` — production FRONTEND_URL.**
   Currently hardcoded as `https://web.ai-data-room.example` for
   non-`$dev` stages. Swap to the real domain when the web app
   gets one (likely as part of T-017 if hosting moves).
10. **Slice-3 LIMIT push for `externalGrantRepo.listByUser`** — TODO
    in the file. v0.1 returns every row (fine at Capital Pay
    scale); slice 3 should add `where status = 'active'` + LIMIT
    once external users routinely accumulate dozens of grants.
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
   doesn't support our Vitest setup. `bun run test` requires
   `sst shell` (AWS creds); `bunx vitest run <pattern>` is the
   no-creds local fast path.
6. **`.claude/` is gitignored + prettier-ignored.**
7. **Migration naming**: drizzle-kit emits
   `0001_<random_nouns>.sql`; rename to `0001_<intent>.sql` and
   update the `tag` in `meta/_journal.json`.
8. **Hand-edited migrations** — pair every hand-touched `*.sql`
   with a `*.down.sql` outside the migrations folder drizzle reads.
9. **WorkOS SDK names** — `userManagement.sendInvitation` (not
   `createInvitation`), `userManagement.createPasswordReset` (no
   `sendPasswordResetEmail` method). The wrapper at
   `infrastructure/workos/client.ts` bridges them.
10. **WorkOS webhooks need a synthetic clientId** —
    `new WorkOS({})` throws; PKCE-mode `new WorkOS({ clientId: ... })`
    is the workaround for signature-verification-only paths.
11. **Repos use `firstOrNull` for "select-one or null" and
    `firstOrThrow` for "update-must-find-row"** — `_helpers.ts` is
    the single home.
12. **AuditRepo cursor is composite `(occurredAt, id) < (cursor)`**
    — the id half is load-bearing for events sharing a millisecond.
13. **All audit writes go through
    `application/audit.ts#recordAuditEvent`**, never
    `AuditRepo.write` directly. Validates the canonical shape +
    strips NFR8 forbidden material.
14. **`safeAudit` in `application/_audit-context.ts`** — every
    application-layer auth flow uses this so an audit-write failure
    doesn't mask the real outcome.
15. **Multi-write transactions use the `withTx(tx)` factory
    pattern.** Every T-007 repo accepts `DbOrTx` and exposes
    `withTx(tx: Tx): ThisRepo`. Awaits inside the txn callback
    MUST stay sequential — Drizzle's tx wraps a single Postgres
    connection.
16. **Login resolves WorkOS org id → local UUID via
    `orgRepo.findByWorkosOrgId`** — `session.organizationId` is the
    WorkOS-side text id, NOT our local UUID. (Same pattern now used
    by `resolveActor`.)
17. **Signup stamps `mfaEnrolledAt` + `emailVerifiedAt` at create-
    time** — without this, fresh signups would fail their first
    login on the FR16 MFA gate. Lazy-mirror in `resolveActor`
    matches this policy.
18. **Suspension revokes WorkOS sessions BEFORE flipping local
    lifecycle.** The spec's "timing test" asserts this ordering
    via `mock.invocationCallOrder`.
19. **`WorkOSClient.listSessions(userId)` auto-paginates** —
    returns a flat `Session[]`.
20. **Cursor Bugbot has caught real bugs on every PR with
    multi-step or external-ID flows.** Always read its findings
    before merging; if it flags something, write a regression test
    that proves the fix before pushing. PR #21 alone took two
    Bugbot findings (`requireAuth`'s per-request SDK construction;
    `findOrLazyMirrorUser`'s bare catch dropping the original
    error's `cause`; the audit-events Invalid Date crashing at the
    SQL layer). All caught after merge but before deploy — the
    pattern works.
21. **WorkOS event names ≠ design.md event names.** v8.13 SDK does
    NOT expose `authentication.mfa_enrolled` or
    `authentication.recovery_code_used` as discriminated event
    types. T-016 acks these as `{ ignored: true }`; the
    application handlers exist but aren't reachable.
22. **API Gateway HTTP API v2 lowercases all header names** before
    invoking the Lambda. No need for TitleCase fallbacks.
23. **Webhook handler 500-response bodies omit error messages** —
    WorkOS surfaces response bodies in its delivery log, and
    pg-driver errors can include connection strings or stack
    frame paths. Full error is `console.error`'d for forensics.
24. **Webhook dedup ordering: insert-then-route, NOT route-then-
    insert.** Trade-off: an application-handler exception leaves
    the dedup row in place, so WorkOS retries will short-circuit
    to replay rather than re-execute. Manual operator recovery is
    `DELETE FROM webhook_deliveries WHERE event_id = '…'` followed
    by re-trigger.
25. **`migrate.integration.test.ts` `EXPECTED_TABLES` is exact-
    match.** Adding any new table to `schema/auth.ts` requires a
    one-line update to that array; otherwise the smoke test fails
    on count mismatch.
26. **`sst-env.d.ts` is auto-generated by SST but committed.** If
    a new secret is declared in `infra/secrets.ts` between SST
    runs, the type entry won't appear until `bun sst dev`
    regenerates. Pattern: manual edit with a `// MANUAL ENTRY
(T-NNN)` marker; the next regen overwrites cleanly.
27. **FDP layout for HTTP handlers: `application/auth/<route>/`** —
    one handler per nested directory. `publicRoutes.ts` +
    `protectedRoutes.ts` are the two route bundles; one shared
    config helper at `config/frontendUrl.ts`. Deliberately NOT
    under `handlers/` — the old `handlers/auth/` directory was
    removed in T-015 (it held only the deleted T-002 health probe).
28. **`setSecureCookie` in `config/frontendUrl.ts` is the
    sanctioned way to set cookies.** Centralises the four invariant
    attributes (`HttpOnly`, `Secure`, `SameSite`, `path`) so adding
    a new cookie can't drop one of them. Used by callback handler
    AND `requireAuth`'s session refresh.
29. **Web Crypto + `globalThis.process` shim for browser-safe type
    graph.** The `CoreApi` type leaks into `packages/web` via Eden
    Treaty, and web's tsconfig doesn't include `@types/node`. Use
    `crypto.randomUUID()` instead of `node:crypto`'s `randomBytes`;
    access env vars via `globalThis.process` (see `frontendUrl.ts`'s
    `NodeProcessLike` declaration).
30. **Module-scope deps in `_shared/deps.ts` for protected handlers,
    plus a dedicated `_shared/workosClient.ts`.** The deps module
    constructs `db` + 6 repos + `workos` once at Lambda init; every
    handler imports `protectedDeps.X` so warm requests reuse. The
    WorkOS client is split into its own file so `requireAuth` can
    import it without dragging in the db/repo graph (keeps that
    guard's test surface narrow). Tests use `vi.doMock(...) +
vi.resetModules() + dynamic import` — same pattern as
    `publicRoutes.test.ts`.
31. **`client_init_failed` 500 still applies to T-014a's callback,
    NOT to T-015's `requireAuth`.** Callback constructs the WorkOS
    client at request scope (sticky #32) so a config error shows
    up per-request as 500 + `client_init_failed`. `requireAuth`
    moved to module-scope construction in PR #21 review — bad
    config now fails Lambda init (deploy-time) rather than
    surfacing as a per-request 500. The Bugbot finding (PR #19,
    sticky #43 of the previous handoff) about splitting the
    catches still holds for the callback because that handler
    doesn't have a module-scope alternative — it's deliberately
    request-scoped for testability.
32. **Callback handler is intentionally thin.** Validates state,
    exchanges code, sets sealed cookie, redirects. Does NOT mirror
    the local `users` row — that's lazy-created in `resolveActor`
    on first protected request (sticky #34). T-008's `handleSignup`
    / `handleLoginCallback` are deadcode-ish; pending follow-up #1.
33. **`infra/api.ts` env vars vs `Resource.*` for URLs.** Pass
    `FRONTEND_URL` and `API_URL` as Lambda env vars (set in
    `infra/api.ts`) rather than via `Resource.web.url` /
    `Resource["api-core"].url`:
    - Linking `web` into the core API Lambda would create a
      circular SST dependency.
    - `API_URL` self-references `coreAPI.url`, resolved lazily.
    - `FRONTEND_URL` is hardcoded for non-`$dev` stages until the
      web app gets a real domain (slice-1 follow-up #9).
34. **Lazy-mirror in `resolveActor`** — fresh organic AuthKit
    signups have a WorkOS user but no local `users` row until the
    first protected request hits this guard, which `find-or-create`s
    via `userRepo.findByWorkosUserId` → `userRepo.create`. The
    create races a concurrent lazy-create on the unique
    `workos_user_id` index; we recover by re-finding. On a real
    failure (not a race), the wrapper Error preserves the original
    via `cause` so CloudWatch sees the underlying issue.
35. **`/me` shape: `role` and `orgId` jointly nullable.** A
    lazy-mirrored user without a membership returns
    `{ role: null, orgId: null, opportunityScopes: [], ... }` —
    that's the signal for the web shell to redirect to slice-9
    onboarding. External users (with active grants but no
    membership) get inferred as `role: "external"`.
36. **Two-sub-bundle protected-routes structure.** `meRoutes` runs
    `requireAuth + resolveActor` only; `orgScopedRoutes` adds
    `.onBeforeHandle(requireOrg)`. Both mounted under one
    `protectedRoutes.ts`. Each Elysia instance's `.onBeforeHandle`
    applies to every route in the same instance — using a single
    bundle and `.guard()` would either run requireOrg on /me or
    require a param-key trick.
37. **Each protected handler narrows actor inline:**
    `(ctx as typeof ctx & { actor: ProtectedAuthContext["actor"] })`.
    Standalone Elysia plugins don't see the parent bundle's
    `.resolve(resolveActor)` augmentation at type level. Same
    pattern FDP uses; each handler also destructures different
    subsets of the context, so a shared wrapper would lose
    precision.
38. **`authorizeOrgAccess` + `isAuthFailure` are the canonical
    org-scoped auth gate.** Cross-org guard (params.orgId ===
    actor.localOrgId) + role check (default owner/admin allowlist)
    rolled into one helper. Returns the `OrgMembership` on success
    or `status(403, ...)` short-circuit; `isAuthFailure(result)`
    narrows. Defence in depth on top of the application function's
    own cross-org check (sticky #20 — Bugbot finding from PR #15).
39. **`buildAuditContext`** extracts `sourceIp` (leftmost
    `x-forwarded-for`) + `userAgent` from headers, both with
    `"unknown"` fallback. Mirrors the webhook Lambda's audit-context
    extraction from the raw event.
40. **FR8b: external_access_grants now carries `expires_at NOT NULL
DEFAULT NOW() + INTERVAL '90 days'`** plus an `expired` enum
    value. Slice 1 stamps the column at grant creation
    (`acceptInvitation`); slice 3 enforces (transition to expired,
    access denial). Hard ceiling is 365 days; override / extension
    knobs land in slice 3.
41. **Erasable-syntax sweep.** Every `constructor(private readonly x: T)`
    parameter property in the repos, error classes, and
    `RepoNotFoundError` was rewritten as field-decl + assignment
    because `protectedRoutes.ts` exposed core types into
    `packages/web`'s `erasableSyntaxOnly: true` tsconfig. Behavior
    identical; future repo / error class additions should follow
    the field-decl pattern.
42. **Sealed sessions have no separate cache.** AuthKit's sealed-
    session JWKS validation is local + JWKS-cached internally on
    warm Lambdas. The cookie blob IS the session state. Original
    design.md "60s LRU cache" plan was dropped (see design.md
    §Key trade-offs amendment).

## Workflow conventions in one paragraph

Branch off `main` per task (`feat/<slice>-T-XXX-<short-desc>`),
one task one PR. Run the full guard set locally before pushing.
Write the simplify-skill review **after** tests pass and **before**
committing — it has caught real wins on every recent PR. Cursor
Bugbot runs on every PR and has caught real bugs on every flow
with external IDs or multi-step ordering. Tasks.md ticks `[~]`
mid-PR and `[x]` after merge. HANDOFF.md is rewritten at every
transition; if you finish a task and there's no next one in flight,
this file gets the brief for the next pickup.
