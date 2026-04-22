// Centralised SST secrets registry.
//
// Provision via:  bun sst secret set <NAME> <VALUE> --stage <stage>
// Inspect via:    bun sst secret list --stage <stage>
//
// Secrets are referenced from microservice handlers as
//   import { Resource } from "sst"; Resource.WorkOSApiKey.value
//
// New secrets land here as slices reach their first integration point.

// ── auth-and-orgs (slice 1, ADR-001 WorkOS) ────────────────────────────
export const workOsApiKey = new sst.Secret("WorkOSApiKey");
export const workOsClientId = new sst.Secret("WorkOSClientId");
export const workOsWebhookSecret = new sst.Secret("WorkOSWebhookSecret");
export const cookieSigningKey = new sst.Secret("CookieSigningKey");

// ── access-control (slice 3, NDA + signed S3 URLs) ─────────────────────
// kmsKeyId for envelope encryption is provisioned in storage.ts; the
// signing-key for download tokens is here.
export const downloadTokenKey = new sst.Secret("DownloadTokenKey");

// ── ai-doc-sensecheck (slice 5) + ai-search-qna (slice 6) ──────────────
export const anthropicApiKey = new sst.Secret("AnthropicApiKey");
export const voyageApiKey = new sst.Secret("VoyageApiKey"); // for embeddings via Anthropic umbrella

// ── billing-subscription (slice 8) ─────────────────────────────────────
export const stripeApiKey = new sst.Secret("StripeApiKey");
export const stripeWebhookSecret = new sst.Secret("StripeWebhookSecret");

// ── onboarding-flow (slice 9) ──────────────────────────────────────────
export const postHogApiKey = new sst.Secret("PostHogApiKey");

// ── infrastructure ─────────────────────────────────────────────────────
// PlanetScale Postgres connection string (per ADR-002). Provisioned
// outside SST; surfaced here so handlers can reach it via Resource.*.
export const databaseUrl = new sst.Secret("DatabaseUrl");

export const allSecrets = [
  workOsApiKey,
  workOsClientId,
  workOsWebhookSecret,
  cookieSigningKey,
  downloadTokenKey,
  anthropicApiKey,
  voyageApiKey,
  stripeApiKey,
  stripeWebhookSecret,
  postHogApiKey,
  databaseUrl,
];
