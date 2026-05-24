// Core HTTP API — owns auth, orgs, rooms, access-control, checklists,
// sense-check, Q&A, admin-dashboard read aggregates, billing, onboarding.
// Per ADR-001 + ADR-002 the layered architecture lives in
// microservices/core/src.
import {
  workos_client_id,
  workos_api_key,
  workos_webhook_secret,
  workos_cookie_password,
  planetscale_database_url,
  e2e_auth_secret,
} from "./secrets";

// `args` is SST's Lambda function input shape. We only touch `runtime`,
// so we type that one field. Widening to any surface SST passes would
// require pulling in `.sst/platform/**` which isn't on the typecheck path
// (see `tsconfig.infra.json` + `infra/_sst-globals.d.ts`).
// TODO: extract to `infra/domains/` once deployed hostnames land
// (mirrors FDP's `webOrigin` pattern). Currently duplicated as the
// CORS allowOrigin and the FRONTEND_URL env literal below.
const frontendOrigin = $dev
  ? "http://localhost:5173"
  : "https://web.ai-data-room.example";

// API-Gateway-level CORS — preflights are answered by the gateway
// directly so the Hono wrapper never sees them and can't remap the
// 204 to a 200. `allowCredentials: true` is load-bearing for the
// SPA's `credentials: "include"` fetches.
//
// Stage-level throttle is the outer DDoS envelope only. HTTP API v2
// doesn't accept AWS WAF (REST API / ALB / CloudFront only), so the
// NFR4 per-IP cap lives at the Elysia layer in
// `middleware/rateLimit.ts`. CloudFront + WAF is Phase 2.
export const coreAPI = new sst.aws.ApiGatewayV2("api-core", {
  cors: {
    allowOrigins: [frontendOrigin],
    allowCredentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  },
  transform: {
    // `defaultRouteSettings` belongs to `aws.apigatewayv2.Stage`,
    // NOT `aws.apigatewayv2.Api` — putting it on `transform.api`
    // results in AWS silently dropping the unknown property and the
    // throttle never landing.
    stage: (args: {
      defaultRouteSettings?: {
        throttlingBurstLimit?: number;
        throttlingRateLimit?: number;
      };
    }) => {
      args.defaultRouteSettings = {
        // 100 req/sec sustained, 200 req/sec burst is far above
        // legitimate steady-state load for v0.1 (single tenant,
        // tens of users) but bounds a runaway client / scraper /
        // probe well below the Lambda concurrent-invocation
        // ceiling. Raise per stage if/when traffic grows.
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      };
    },
    route: {
      handler: (args: { runtime?: string }) => {
        args.runtime ??= "nodejs22.x";
      },
    },
  },
});

// $default route: every HTTP request not matched by a more specific
// route below lands here. WorkOS + PlanetScale secrets are linked at
// this level so all auth-and-orgs handlers (and any layered handler they
// call) can read them via `Resource.<NAME>.value`.
//
// Per-stage secret values must be provisioned before this stack will
// deploy successfully:
//   bun sst secret set <NAME> <VALUE> --stage <stage>
// Powertools observability env vars consumed by the singletons at
// `microservices/core/src/infrastructure/{logging,observability}/`.
// `INFO` in production keeps log volume sane; `DEBUG` in dev surfaces
// the structured fields locally without per-developer config drift.
const POWERTOOLS_LOG_LEVEL = $app.stage === "production" ? "INFO" : "DEBUG";
const METRICS_NAMESPACE = "AiDataRoom/Auth";

// X-Ray active tracing — the Powertools Tracer singleton at
// `infrastructure/observability/tracer.ts` is a no-op without this.
const enableXRay = (args: { tracingConfig?: { mode?: string } }) => {
  args.tracingConfig = { mode: "Active" };
};

// `e2e_auth_secret` is `undefined` in production (the bootstrap
// handler also returns 404 there as defence-in-depth — see
// `application/auth/e2e-bootstrap/postE2EAuthLoginHandler.ts`).
// Spread-conditional inclusion keeps the link list valid either way.
coreAPI.route("$default", {
  handler: "microservices/core/src/api.handler",
  name: `core-api-${$app.stage}`,
  link: [
    workos_client_id,
    workos_api_key,
    workos_webhook_secret,
    workos_cookie_password,
    planetscale_database_url,
    ...(e2e_auth_secret ? [e2e_auth_secret] : []),
  ],
  environment: {
    SST_STAGE: $app.stage,
    FRONTEND_URL: frontendOrigin,
    // API_URL: coreAPI.url self-references its own output — SST
    // resolves this lazily so the self-reference doesn't deadlock.
    API_URL: coreAPI.url,
    POWERTOOLS_SERVICE_NAME: "core-api",
    POWERTOOLS_LOG_LEVEL,
    POWERTOOLS_METRICS_NAMESPACE: METRICS_NAMESPACE,
  },
  memory: "512 MB",
  transform: { function: enableXRay },
});

// Dedicated webhook handler — sits outside the Hono/Elysia stack so that
// API Gateway passes the raw body string to the Lambda. Required for
// WorkOS HMAC-SHA256 signature verification (T-016 / T-006). The link
// list mirrors `$default` minus `workos_cookie_password` (no session
// cookies on the webhook path) — `workos_api_key` + `workos_client_id`
// are needed because the password-reset webhook calls
// `workos.listSessions` + `workos.revokeSession` to terminate sessions
// after the new password takes effect.
coreAPI.route("POST /webhooks/workos", {
  handler: "microservices/core/src/handlers/webhooks/workosLambda.handler",
  name: `core-webhook-workos-${$app.stage}`,
  link: [
    workos_client_id,
    workos_api_key,
    workos_webhook_secret,
    planetscale_database_url,
  ],
  environment: {
    SST_STAGE: $app.stage,
    POWERTOOLS_SERVICE_NAME: "workos-webhook",
    POWERTOOLS_LOG_LEVEL,
    POWERTOOLS_METRICS_NAMESPACE: METRICS_NAMESPACE,
  },
  memory: "256 MB",
  transform: { function: enableXRay },
});

// Async workers. Currently a stub — will host:
//   - sense-check SQS worker (slice 5: ai-doc-sensecheck)
//   - reconciliation jobs (billing + onboarding activation metrics)
//   - daily ops (audit retention, drift checks)
// Wired in once the first slice that needs it (slice 5) reaches its tasks.
// export const workersAPI = new sst.aws.ApiGatewayV2("api-workers");
// workersAPI.route("$default", "microservices/workers/src/api.handler");

// Authorisers (WorkOS session) attached on per-route basis from
// microservices/core/src/middleware once auth-and-orgs T-007+ lands.
