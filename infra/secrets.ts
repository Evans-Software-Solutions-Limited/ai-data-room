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

// ── DEFERRED — declare in the slice that first needs them ──────────────
// Each comment marks the slice + task that should add the declaration.
//
// access-control (slice 3 T-???):       DOWNLOAD_TOKEN_KEY
// ai-doc-sensecheck (slice 5 T-???):    ANTHROPIC_API_KEY
// ai-search-qna (slice 6 T-???):        VOYAGE_API_KEY
// billing-subscription (slice 8 T-???): STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET
// onboarding-flow (slice 9 T-???):      POSTHOG_API_KEY
// auth-and-orgs T-003 (db setup):       PLANETSCALE_DATABASE_URL
