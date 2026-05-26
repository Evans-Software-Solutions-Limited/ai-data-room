// Centralised SST secrets registry.
//
// Naming convention (matches FDP `infra/secrets.ts`):
//   - export name: snake_case
//   - sst.Secret name string: SCREAMING_SNAKE
//
// **Convention:** declare a secret HERE only when the slice that uses
// it ships. SST resolves every declared `new sst.Secret(...)` at deploy
// time and refuses to deploy if any value is missing — pre-declaring
// future-slice secrets blocks all deploys until those values are set.
//
// Provision per stage:
//   bun sst secret set <NAME> <VALUE> --stage <stage>
// Inspect:
//   bun sst secret list --stage <stage>
// Access from handlers (typed via sst-env.d.ts):
//   import { Resource } from "sst";
//   Resource.WORKOS_API_KEY.value;

// ── auth-and-orgs (slice 1, ADR-001 WorkOS) ────────────────────────────
export const workos_client_id = new sst.Secret("WORKOS_CLIENT_ID");
export const workos_api_key = new sst.Secret("WORKOS_API_KEY");
export const workos_webhook_secret = new sst.Secret("WORKOS_WEBHOOK_SECRET");
// AuthKit cookie password (HMAC for session cookie). 32+ chars random
// — generate with `openssl rand -base64 48`. Not retrievable from the
// WorkOS dashboard; you mint it yourself. Don't reuse across stages.
export const workos_cookie_password = new sst.Secret("WORKOS_COOKIE_PASSWORD");

// Shared secret guarding the `/e2e/auth/login` bootstrap endpoint
// (T-021 Playwright suite). Declared only outside production so the
// production stack never has a value to misconfigure — the handler
// also short-circuits to 404 in production as defence-in-depth.
// Provision per non-prod stage with `bun sst secret set
// E2E_AUTH_SECRET <random-string> --stage <stage>`.
export const e2e_auth_secret =
  $app.stage === "production" ? undefined : new sst.Secret("E2E_AUTH_SECRET");

// ── auth-and-orgs T-003 (DB setup, ADR-002 Postgres + Drizzle) ─────────
// PlanetScale Postgres connection string for the canonical domain DB.
// Format: postgres://user:pass@host:5432/db?sslmode=require
// Provision per stage out-of-band (PlanetScale dashboard) and:
//   bun sst secret set PLANETSCALE_DATABASE_URL <url> --stage <stage>
// Consumed by `packages/db/src/index.ts#getDb()` from
// `Resource.PLANETSCALE_DATABASE_URL.value` at handler entry. Bound to
// the core API Lambda in infra/api.ts and to drizzle-kit at migration
// time via the same env var (see packages/db/drizzle.config.ts).
export const planetscale_database_url = new sst.Secret(
  "PLANETSCALE_DATABASE_URL",
);

// ── DEFERRED — declare in the slice that first needs them ──────────────
// Each comment marks the slice + task that should add the declaration.
//
// access-control (slice 3 T-???):       DOWNLOAD_TOKEN_KEY
// ai-doc-sensecheck (slice 5 T-???):    ANTHROPIC_API_KEY
// ai-search-qna (slice 6 T-???):        VOYAGE_API_KEY
// billing-subscription (slice 8 T-???): STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET
// onboarding-flow (slice 9 T-???):      POSTHOG_API_KEY
