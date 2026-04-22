// Centralised SST secrets registry.
//
// Naming convention (matches FDP `infra/secrets.ts`):
//   - export name: snake_case
//   - sst.Secret name string: SCREAMING_SNAKE
//
// Provision per stage:
//   bun sst secret set <NAME> <VALUE> --stage <stage>
//
// Inspect:
//   bun sst secret list --stage <stage>
//
// Access from handlers (typed via sst-env.d.ts):
//   import { Resource } from "sst";
//   Resource.WORKOS_API_KEY.value;
//
// New secrets land here as slices reach their first integration point.

// ── auth-and-orgs (slice 1, ADR-001 WorkOS) ────────────────────────────
export const workos_client_id = new sst.Secret("WORKOS_CLIENT_ID");
export const workos_api_key = new sst.Secret("WORKOS_API_KEY");
export const workos_webhook_secret = new sst.Secret("WORKOS_WEBHOOK_SECRET");
// AuthKit cookie password (HMAC for session cookie). 32+ chars random.
export const workos_cookie_password = new sst.Secret("WORKOS_COOKIE_PASSWORD");

// ── access-control (slice 3, NDA + signed S3 URLs) ─────────────────────
// Envelope-encryption KMS key id is in storage.ts; the signing key for
// download tokens lives here.
export const download_token_key = new sst.Secret("DOWNLOAD_TOKEN_KEY");

// ── ai-doc-sensecheck (slice 5) + ai-search-qna (slice 6) ──────────────
export const anthropic_api_key = new sst.Secret("ANTHROPIC_API_KEY");
// Voyage embeddings via the Anthropic umbrella (1024-dim).
export const voyage_api_key = new sst.Secret("VOYAGE_API_KEY");

// ── billing-subscription (slice 8) ─────────────────────────────────────
export const stripe_api_key = new sst.Secret("STRIPE_API_KEY");
export const stripe_webhook_secret = new sst.Secret("STRIPE_WEBHOOK_SECRET");

// ── onboarding-flow (slice 9) ──────────────────────────────────────────
export const posthog_api_key = new sst.Secret("POSTHOG_API_KEY");

// ── infrastructure ─────────────────────────────────────────────────────
// PlanetScale Postgres connection string (per ADR-002). Provisioned
// outside SST; surfaced here so handlers can reach it via Resource.*.
export const planetscale_database_url = new sst.Secret(
  "PLANETSCALE_DATABASE_URL",
);

export const allSecrets = [
  workos_client_id,
  workos_api_key,
  workos_webhook_secret,
  workos_cookie_password,
  download_token_key,
  anthropic_api_key,
  voyage_api_key,
  stripe_api_key,
  stripe_webhook_secret,
  posthog_api_key,
  planetscale_database_url,
];
