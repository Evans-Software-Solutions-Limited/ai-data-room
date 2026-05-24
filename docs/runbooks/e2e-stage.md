# E2E stage provisioning

What you need to set up before the Playwright suite (`.github/workflows/e2e.yml`)
can go green. One-time per stage that runs the suite (typically just
`staging` for the nightly cadence; `dev` is fine for local runs).

The high-level flow:

1. **WorkOS test tenant** — a dedicated WorkOS organisation with a
   handful of pre-verified users at known passwords.
2. **`E2E_AUTH_SECRET` per stage** — random string the
   `/e2e/auth/login` bootstrap handler requires in the `x-e2e-key`
   header. Without it the handler returns 503.
3. **Per-environment env vars** — both locally (`.env.e2e`) and in
   GitHub Actions (repo secrets + variables).

The bootstrap handler itself self-gates: it returns 404 if
`SST_STAGE === "production"` regardless of any other configuration,
so even a misconfigured deploy can't expose it in prod.

---

## 1. WorkOS test tenant

In the [WorkOS dashboard](https://dashboard.workos.com), for each
stage you want to run E2E against (recommended: `staging` only for
CI, optional: `dev` for local runs):

1. Create a separate **organization** named something explicit like
   `ai-data-room-e2e-staging`. Distinct org → distinct user pool →
   no chance of cross-pollinating staging test data with a real user.
2. Under **User Management → Users**, add at least one user with:
   - Email: `e2e-owner@ai-data-room.test` (or any address you control).
   - Password: a strong random string. Note it for step 3.
   - **Email verified** (toggle on after creation).
   - **MFA enrolled**: optionally enrol TOTP via the AuthKit hosted
     flow once, save the seed. The bootstrap handler uses
     `authenticateWithPassword` which bypasses the MFA challenge
     when `sealSession: true` is requested AND the user has already
     completed enrolment — so a once-and-done enrolment lets every
     subsequent test run skip MFA.
3. (Optional) Add `e2e-admin@...`, `e2e-internal@...`, `e2e-external@...`
   for the AC-US specs that need role variants — currently
   `.skip`'d in `_deferred.spec.ts` but worth seeding now so future
   unskip is one-line.

### Expected `/me` shape for the bootstrap user

The bootstrap user **starts unprovisioned**: it has a WorkOS
identity but no local org membership in our Postgres until slice 9
(`onboarding-flow`) ships the org-creation surface. That means
`resolveActor`'s lazy-mirror creates the `users` row on first
protected request, but `localOrgId` stays `null` and `/me` returns
`{ orgId: null, role: null, ... }`. The web shell renders the
"Welcome to AI Data Room" placeholder rather than the workspace
payload.

The active AC-US1 spec is built to pass against this state — it
asserts the authenticated navbar (sign-out anchor visible +
absolute), not the placeholder content. The provisioned-user
branch gets coverage when slice 9 lands.

If you need to short-circuit slice 9 to test the provisioned
branch before then, the operator path is a one-off SQL insert
against the staging DB:

```sql
-- Replace the WorkOS IDs with the values from your test tenant.
INSERT INTO organizations (id, workos_org_id, name, slug, status, created_at, updated_at)
VALUES (gen_random_uuid(), 'org_workos_id_here', 'E2E Staging Org', 'e2e-staging', 'active', now(), now());

INSERT INTO org_memberships (id, org_id, user_id, role, created_at, updated_at)
SELECT gen_random_uuid(), o.id, u.id, 'owner', now(), now()
FROM organizations o, users u
WHERE o.workos_org_id = 'org_workos_id_here'
  AND u.workos_user_id = 'user_workos_id_here';
```

Also wire the test user into the WorkOS organization via the
dashboard so the sealed session carries `organizationId`.

---

## 2. `E2E_AUTH_SECRET` per stage

Generate a random secret and set it as an SST secret on every
non-production stage:

```sh
SECRET=$(openssl rand -base64 32)
bun sst secret set E2E_AUTH_SECRET "$SECRET" --stage staging
bun sst secret set E2E_AUTH_SECRET "$SECRET" --stage dev   # optional
```

Verify with `bun sst secret list --stage staging`. You'll need this
exact value in step 3 too.

`infra/secrets.ts` declares the secret only when
`$app.stage !== "production"`, so the production stack can't have a
value to misconfigure.

---

## 3. Env vars per consumer

### Local runs

Create `.env.e2e` at the repo root (gitignored):

```sh
PLAYWRIGHT_BASE_URL=https://web-staging.ai-data-room.example
VITE_CORE_API_URL=https://api-staging.ai-data-room.example
E2E_AUTH_SECRET=<the random secret from step 2>
E2E_TEST_EMAIL=e2e-owner@ai-data-room.test
E2E_TEST_PASSWORD=<the password you set in step 1>
```

Then `bun run test:e2e:install` once to grab the browser binaries,
and `bun run test:e2e` to run the suite. `bun run test:e2e --headed`
opens the browser for debugging.

### GitHub Actions

Repository **secrets** (Settings → Secrets and variables → Actions →
New repository secret):

- `E2E_AUTH_SECRET` — same value as the SST secret.
- `E2E_TEST_EMAIL` — same email as `.env.e2e`.
- `E2E_TEST_PASSWORD` — same password.

Repository **variables** (same settings page, Variables tab):

- `STAGING_WEB_URL` — `https://web-staging.ai-data-room.example`
  (or whatever the deployed-stage web URL is).
- `STAGING_API_URL` — the matching API URL.

Once all five are present, the `Playwright E2E` workflow runs after
every successful `Staging Deploy`. Without any of them the workflow
emits a `::warning::` and exits 0 — fork PRs keep going green.

---

## 4. Manual smoke after first provisioning

After setting all of the above, fire a manual run of the workflow
via the GitHub UI (Actions → Playwright E2E → Run workflow). It
should:

1. Pass `Skip if secrets are unconfigured`.
2. Install Chromium (~30 s).
3. Run global-setup against the deployed stage (~5 s — hits
   `/e2e/auth/login`, writes `.auth/session.json`).
4. Run the 3 active specs (~30 s for the lot).
5. Upload `playwright-report/` as an artifact you can download +
   open locally if anything failed.

If global-setup fails with `[global-setup] /e2e/auth/login failed:
401`, the `E2E_AUTH_SECRET` you set as a GitHub secret doesn't
match the one provisioned with `bun sst secret set`.

If it fails with `503 e2e_secret_unconfigured`, the secret hasn't
been provisioned on the stage (or hasn't propagated — SST can take
a deploy cycle to surface a new secret). Run
`bun sst secret list --stage staging` to verify.

If it fails with `404 not_found`, you're hitting the production
stage by mistake — check `VITE_CORE_API_URL`.

---

## 5. Unskipping the deferred specs

`e2e/specs/auth-and-orgs/_deferred.spec.ts` has 8 `test.skip(...)`
placeholders, each with a short note on what's needed to unskip.
The most common dependency is a **mailbox-test harness** for the
invitation / verification / password-reset flows. Recommended
options when you get there:

- [Mailosaur](https://mailosaur.com) — paid SaaS, no infra to run.
- [Postmark sandbox](https://postmarkapp.com/blog/inbound-testing-using-the-development-server)
  — included free with a Postmark account, dev-focused.
- [GreenMail in Docker](https://greenmail-mail-test.github.io/) —
  self-hosted, fine for dev but adds CI complexity.

Pick one when slice 2 + 3 ship — the invitation / external-grant
ACs are the first ones that genuinely need it.
