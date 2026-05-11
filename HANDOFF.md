# HANDOFF.md

> Ephemeral. Describes what's currently in flight and what the next
> session should pick up. Refreshed at every task transition; delete
> once steady state ("look at `tasks.md`") is safe to assume.

**Last updated:** 2026-05-10 by Claude Code, T-017 web shell open as
PR #24. Branch `feat/auth-and-orgs-T-017-web-shell`. Awaiting `bun
sst diff` (no AWS creds in the build session) and a manual auth
smoke before merge.

## Where we are in slice 1 (auth-and-orgs)

The HTTP surface (public + protected) plus the SPA's auth shell are
landed (or in PR review). What's left: observability, hardening,
e2e, and the slice tag.

| Task   | Status       | Notes                                                                                   |
| ------ | ------------ | --------------------------------------------------------------------------------------- |
| T-001  | ✅           | Repo scaffold.                                                                          |
| T-002  | ✅           | WorkOS + secrets wiring (PR #1). `/_health/workos` deleted in T-015.                    |
| T-003  | ✅           | Postgres + Drizzle setup (PR #3).                                                       |
| T-004  | ✅           | Domain types + zod schemas (PR #4).                                                     |
| T-005  | ✅           | Postgres-specific DDL augments (PR #5).                                                 |
| T-006  | ✅           | WorkOS client wrapper + webhook verifier (PR #6).                                       |
| T-007  | ✅           | Typed Drizzle repositories (PR #7).                                                     |
| T-013  | ✅           | Application-layer audit event writer (PR #8).                                           |
| T-008  | ✅ (retired) | Signup + login callback flows shipped in PR #9, retired in PR #23 — lazy-mirror covers. |
| T-012  | ✅           | Suspension lifecycle + `WorkOSClient.listSessions` (PR #10).                            |
| T-011  | ✅           | Password reset (PR #12).                                                                |
| T-010  | ✅           | MFA enrolment + recovery-code-used audit (PR #13, scope trimmed by ADR-003).            |
| –      | ✅           | Chore: repos accept `Db \| PgTransaction` + signup wraps multi-write (PR #14).          |
| T-009  | ✅           | Application: invitations (PR #15).                                                      |
| T-019  | ✅           | GDPR hard-delete (PR #16).                                                              |
| T-016  | ✅           | WorkOS webhook routing + dedup ledger (PR #17).                                         |
| T-014a | ✅           | Public auth routes — sign-in / sign-up / callback / sign-out (PR #19).                  |
| T-014b | ✅           | Protected routes — /me + invitations CRUD + suspend/unsuspend + audit-events (PR #21).  |
| T-015  | ✅           | Session middleware — `requireAuth` + `resolveActor` + `requireOrg` (PR #21).            |
| T-017  | 🎯 **in PR** | Minimal web shell — PR #24, branch `feat/auth-and-orgs-T-017-web-shell`.                |
| T-018  | ⏳           | Observability — logs / metrics / alerts. Parallelisable with T-017.                     |
| T-020  | ⏳           | Rate limiting + NFR hardening. Parallelisable with T-017.                               |
| T-021  | ⏳           | Playwright acceptance suite. Depends on T-017.                                          |
| T-022  | ⏳           | Slice sign-off + traceability matrix + tag. Last.                                       |

Slice 1 is **~95% done by task count**. Critical path: T-017 merge →
T-021 → T-022. T-018 + T-020 in parallel any time.

## What PR #24 ships (T-017)

Mirrors FDP's container/hook/eden patterns; visually deliberately
ugly pending the dedicated UI design pass.

**Pages** (under `packages/web/src/pages/`):

- `Home.tsx` — public landing. Anon: sign-in / sign-up affordances.
  Authed: link to `/app`.
- `Login.tsx`, `Signup.tsx`, `Logout.tsx` — full-page redirects to
  `/auth/{sign-in,sign-up,sign-out}`. `window.location.assign` on
  mount, not React Router transition (cookie-setting redirect chain
  needs a real navigation).
- `AppWorkspace.tsx` — authed `/me` dashboard. Renders userId,
  email, role, orgId, mfaEnrolled, lifecycleState, opportunityScopes.
  Branches on `orgId === null` to a slice-9 onboarding placeholder.
- `Mfa.tsx` — informational. **Departs from the original task line**
  (which called for a recovery-codes download UI) — ADR-003 delegates
  the entire view+download UX to AuthKit, so we never see plaintext
  codes. Page exists so a stale `/mfa` link resolves usefully.

**Layout containers** (mirror FDP):

- `containers/LoggedInPageLayout.tsx` — gates protected routes,
  `<Navigate to="/" />` on unauth.
- `containers/LoggedOutPageLayout.tsx` — public pages with
  auth-aware navbar (avoids anon→authed flicker on back-button nav).

**Plumbing**:

- `lib/eden.ts` — adds `fetch: { credentials: "include" }`.
- `hooks/api/useGetCurrentUser.ts` — `/me` query, `retry: false`,
  `staleTime: 60_000`.
- `constants/api.ts` + `constants/authUrls.ts` — `CORE_API_URL`
  (empty in dev for relative URLs, absolute in prod) + href factories.
- `lib/userDisplayName.ts` — fullName-or-email helper.
- `components/Loader.tsx`, `components/NavBar.tsx` — minimal.
- `vite.config.ts` — dev proxy for `/auth/*`, `/me`, `/orgs/*` →
  `VITE_PROXY_TARGET`. Caddy-lite: same-origin in dev without the
  Caddy + `.test` domains FDP uses. Cookies work because
  `localhost:5173` is both the SPA origin and the proxied API origin.
- `infra/api.ts` — adds `cors: { allowOrigins: [frontendOrigin],
allowCredentials: true, ... }` to `coreAPI`. Mirrors FDP. API-GW
  level (not Elysia middleware) so the gateway answers preflights
  without invoking the Lambda.
- `infra/web.ts` — `VITE_CORE_API_URL` empty in dev (relative URLs
  via proxy), `coreAPI.url` in prod. `VITE_PROXY_TARGET: coreAPI.url`
  for the dev server.
- Retires unused `useGetHelloWorld` hook + test.

**Coverage**: 100% statements / 100% lines / 100% functions / 91%
branches (above the 90% gate). 47 Vitest tests across pages,
layouts, hook, NavBar, eden, userDisplayName, authUrls.

## Open before-merge questions for PR #24

1. **`bun sst diff --stage <dev>`** — couldn't run (no AWS creds in
   the build session). Per sticky #2, infra typecheck won't catch
   SST component-name typos. Brad to verify before merge. Risk is
   low — the `cors` shape on `sst.aws.ApiGatewayV2` matches FDP's
   `infra/api.ts` exactly.
2. **Manual sign-in smoke** — needs `bun sst dev` running with
   WorkOS dev creds + `bun run dev` for the SPA. Brad to verify
   `signup → AuthKit → callback → /me` round-trip once before merge.

## Faster alternatives if Brad wants to ship T-018 / T-020 first

- **T-018 (observability)** — pino structured logs + CloudWatch EMF
  metrics + the five alerts from design.md. Parallelisable with the
  T-017 review cycle. Sticky #34 (webhook 500-bodies omit error
  messages) interacts here — the structured logger replaces the
  forensics `console.error`.
- **T-020 (rate limiting + NFR hardening)** — API GW IP-based +
  per-handler email-based limits + the NFR matrix test file +
  `docs/security.md`. Mostly infra config.

## Pending follow-ups (not blocking, but worth doing soon)

1. **`AuthFlowError` generic** — `SuspensionError`,
   `PasswordResetRequestError`, `PasswordResetCompletionError`,
   `InvitationError` are nearly identical class shells (4 left
   post-PR-#23). Could extract a generic `AuthFlowError<R extends string>`
   to `application/_errors.ts`.
2. **`revokeAllActiveSessions` helper** — `password-reset.ts` and
   `suspension.ts` have identical list-then-filter-then-fan-out
   blocks.
3. **Shared application-test fixtures** — `makeUser` / `makeSession`
   / `makeOrg` etc. duplicate across 8+ test files.
4. **`scripts/manual-gdpr-delete.ts`** — referenced in
   `ops/runbooks/gdpr-delete.md` as the WorkOS-down fallback;
   doesn't exist yet. Phase 2.
5. **MFA application handler wiring** — `handleMfaEnrolled` and
   `handleRecoveryCodeUsed` exist but aren't reachable by any
   webhook (T-016 acks the relevant event types as `ignored`).
   Wire once the WorkOS event-name investigation lands.
6. **`AUDIT_REASONS` constants** — stringly-typed `metadata.reason`
   literals across 4 application files.
7. **`lookupUserOrAuditFailureForWebhook` helper** — 5 webhook
   callers now (password-reset, mfa-enrolled, recovery-code-used,
   accept-invitation, deletion). Genuinely warranted; cross-aggregate
   refactor PR.
8. **`sst-env.d.ts` + `infra/api.ts` — production FRONTEND_URL.**
   Currently hardcoded as `https://web.ai-data-room.example` for
   non-`$dev` stages. Swap to the real domain when the web app
   gets one. T-017 also added `frontendOrigin` as a duplicate
   literal in `infra/api.ts` (CORS allowOrigin + FRONTEND_URL env);
   both become the same single domain extraction (mirror FDP's
   `infra/domains/index.ts`).
9. **`infra/web.ts` Next.js comment is stale.** Per PR #22 the
   stack is locked to Vite. Remove the "ai-data-room will move to
   Next.js" paragraph in `infra/web.ts:6-12`.
10. **Slice-3 LIMIT push for `externalGrantRepo.listByUser`** — TODO
    in the file. v0.1 returns every row (fine at Capital Pay
    scale); slice 3 should add `where status = 'active'` + LIMIT
    once external users routinely accumulate dozens of grants.
11. **Caddy + `.test` dev domains** — T-017 ships a Vite proxy as
    Caddy-lite. If the dev experience needs to converge with FDP
    exactly (e.g. when slice-2 needs cross-subdomain cookie
    behaviour to match prod), pull in FDP's `infra/domains/index.ts`
    - Caddy setup.

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
    that proves the fix before pushing.
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
    (T-018's structured logger should replace the `console.error`.)
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
    under `handlers/`.
28. **`setSecureCookie` in `config/frontendUrl.ts` is the
    sanctioned way to set cookies.** Centralises the four invariant
    attributes (`HttpOnly`, `Secure`, `SameSite`, `path`) so adding
    a new cookie can't drop one of them. Used by callback handler
    AND `requireAuth`'s session refresh.
29. **Web Crypto + `globalThis.process` shim for browser-safe type
    graph.** The `CoreApi` type leaks into `packages/web` via Eden
    Treaty. Use `crypto.randomUUID()` instead of `node:crypto`'s
    `randomBytes`; access env vars via `globalThis.process` (see
    `frontendUrl.ts`'s `NodeProcessLike` declaration). Note:
    `packages/web` now has `@types/node` in devDeps so this is
    less critical for the web package itself, but the shared-type-
    graph rule still applies.
30. **Module-scope deps in `_shared/deps.ts` for protected handlers,
    plus a dedicated `_shared/workosClient.ts`.** The deps module
    constructs `db` + 6 repos + `workos` once at Lambda init; every
    handler imports `protectedDeps.X` so warm requests reuse. The
    WorkOS client is split into its own file so `requireAuth` can
    import it without dragging in the db/repo graph (keeps that
    guard's test surface narrow).
31. **`client_init_failed` 500 still applies to T-014a's callback,
    NOT to T-015's `requireAuth`.** Callback constructs the WorkOS
    client at request scope (sticky #32) so a config error shows
    up per-request as 500 + `client_init_failed`. `requireAuth`
    moved to module-scope construction in PR #21 review — bad
    config now fails Lambda init (deploy-time) rather than
    surfacing as a per-request 500.
32. **Callback handler is intentionally thin.** Validates state,
    exchanges code, sets sealed cookie, redirects. Does NOT mirror
    the local `users` row — that's lazy-created in `resolveActor`
    on first protected request (sticky #34). T-008's `handleSignup`
    / `handleLoginCallback` were retired in PR #23 (they were
    deadcode-ish since T-014a; the lazy-mirror covers).
33. **`infra/api.ts` env vars vs `Resource.*` for URLs.** Pass
    `FRONTEND_URL` and `API_URL` as Lambda env vars (set in
    `infra/api.ts`) rather than via `Resource.web.url` /
    `Resource["api-core"].url`:
    - Linking `web` into the core API Lambda would create a
      circular SST dependency.
    - `API_URL` self-references `coreAPI.url`, resolved lazily.
    - `FRONTEND_URL` is hardcoded for non-`$dev` stages until the
      web app gets a real domain (slice-1 follow-up #8).
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
    own cross-org check.
39. **`buildAuditContext`** extracts `sourceIp` (leftmost
    `x-forwarded-for`) + `userAgent` from headers, both with
    `"unknown"` fallback. Mirrors the webhook Lambda's audit-context
    extraction from the raw event.
40. **FR8b: external_access_grants now carries `expires_at NOT NULL
DEFAULT NOW() + INTERVAL '90 days'`** plus an `expired` enum
    value. Slice 1 stamps the column at grant creation
    (`acceptInvitation`); slice 3 enforces (transition to expired,
    access denial). Hard ceiling is 365 days.
41. **Erasable-syntax sweep.** Every `constructor(private readonly x: T)`
    parameter property in the repos, error classes, and
    `RepoNotFoundError` was rewritten as field-decl + assignment
    because `protectedRoutes.ts` exposed core types into
    `packages/web`'s `erasableSyntaxOnly: true` tsconfig. Future
    repo / error class additions should follow the field-decl pattern.
42. **Sealed sessions have no separate cache.** AuthKit's sealed-
    session JWKS validation is local + JWKS-cached internally on
    warm Lambdas. The cookie blob IS the session state. Original
    design.md "60s LRU cache" plan was dropped.
43. **Recovery codes are entirely owned by AuthKit per ADR-003.**
    Plaintext codes never enter our system. T-017's `Mfa.tsx` page
    reflects this — informational only, not a download UI.
44. **Web shell auth-state model is "GET /me on app load, treat 401
    as anonymous"** (T-017). `useGetCurrentUser` is the single
    source of truth — TanStack Query dedupes concurrent consumers
    via shared `["currentUser"]` queryKey + a single `QueryClient`
    in `App.tsx`. `retry: false` because 401 is a deliberate
    signal; `staleTime: 60_000` so route changes within the window
    don't refetch.
45. **Auth UI redirects use `window.location.assign`, not React
    Router.** Sealed-session cookies are set via `Set-Cookie`
    headers on the `/auth/callback` redirect, which only land on a
    real browser navigation. Login/Signup/Logout pages do
    `useEffect(() => window.location.assign(href), [])` on mount.
    StrictMode double-fire is harmless because `location.assign` is
    idempotent.
46. **Sign-out is `GET /auth/sign-out`, not POST.** No CSRF token
    needed because cookie removal is idempotent and the route only
    touches the caller's own session. Web shell's `Logout.tsx` is a
    single redirect page.
47. **Dev cookie strategy = Vite proxy, not Caddy.** FDP makes the
    API same-origin in dev via Caddy + `.test` domains; we use a
    Vite dev proxy for `/auth/*`, `/me`, `/orgs/*` targeting
    `VITE_PROXY_TARGET` (set by `infra/web.ts` to `coreAPI.url`).
    Production CORS is at API-Gateway level — `infra/api.ts`'s
    `cors: { allowOrigins: [frontendOrigin], allowCredentials: true }`.
    Avoid `@elysiajs/cors` middleware: the Hono wrapper remaps
    the 204 preflight to a 200 (FDP comment in their `api.ts`).
48. **`packages/web` test fixtures for `/me` should pass the full
    user shape** — TanStack Query's type narrowing relies on the
    `data.status === 200` discriminator landing on a complete
    `MeResponse`. Partial fixtures break the type and won't even
    compile.

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
