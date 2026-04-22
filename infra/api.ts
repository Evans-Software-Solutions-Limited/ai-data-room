// Core HTTP API — owns auth, orgs, rooms, access-control, checklists,
// sense-check, Q&A, admin-dashboard read aggregates, billing, onboarding.
// Per ADR-001 + ADR-002 the layered architecture lives in
// microservices/core/src.
import {
  workos_client_id,
  workos_api_key,
  workos_webhook_secret,
  workos_cookie_password,
} from "./secrets";

export const coreAPI = new sst.aws.ApiGatewayV2("api-core", {
  transform: {
    route: {
      handler: (args) => {
        args.runtime ??= "nodejs22.x";
      },
    },
  },
});

// $default route: every HTTP request not matched by a more specific
// route below lands here. WorkOS secrets are linked at this level so
// all auth-and-orgs handlers (and any layered handler they call) can
// read them via `Resource.<NAME>.value`.
//
// Per-stage secret values must be provisioned before this stack will
// deploy successfully:
//   bun sst secret set <NAME> <VALUE> --stage <stage>
//
// DB secret (PLANETSCALE_DATABASE_URL) will be added to this link[] as
// part of auth-and-orgs T-003 when the `packages/db` workspace is
// wired in. See `infra/secrets.ts` for the deferred-secret ledger.
coreAPI.route("$default", {
  handler: "microservices/core/src/api.handler",
  name: `core-api-${$app.stage}`,
  link: [
    workos_client_id,
    workos_api_key,
    workos_webhook_secret,
    workos_cookie_password,
  ],
  environment: {
    SST_STAGE: $app.stage,
  },
  memory: "512 MB",
});

// Dedicated webhook handler — sits outside the Hono/Elysia stack so that
// API Gateway passes the raw body string to the Lambda. Required for
// WorkOS HMAC-SHA256 signature verification (T-016 / T-006). Lands then
// (db secret added as part of T-003):
// coreAPI.route("POST /webhooks/workos", {
//   handler: "microservices/core/src/handlers/webhooks/workos.handler",
//   name: `core-webhook-workos-${$app.stage}`,
//   link: [workos_api_key, workos_webhook_secret /* + planetscale_database_url from T-003 */],
//   environment: { SST_STAGE: $app.stage },
//   memory: "256 MB",
// });

// Async workers. Currently a stub — will host:
//   - sense-check SQS worker (slice 5: ai-doc-sensecheck)
//   - reconciliation jobs (billing + onboarding activation metrics)
//   - daily ops (audit retention, drift checks)
// Wired in once the first slice that needs it (slice 5) reaches its tasks.
// export const workersAPI = new sst.aws.ApiGatewayV2("api-workers");
// workersAPI.route("$default", "microservices/workers/src/api.handler");

// Authorisers (WorkOS session) attached on per-route basis from
// microservices/core/src/middleware once auth-and-orgs T-007+ lands.
