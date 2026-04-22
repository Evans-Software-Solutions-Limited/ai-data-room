// Core HTTP API — owns auth, orgs, rooms, access-control, checklists,
// sense-check, Q&A, admin-dashboard read aggregates, billing, onboarding.
// Per ADR-001 + ADR-002 the layered architecture lives in
// microservices/core/src.
export const coreAPI = new sst.aws.ApiGatewayV2("api-core");

coreAPI.route("$default", "microservices/core/src/api.handler");

// Async workers. Currently a stub — will host:
//   - sense-check SQS worker (slice 5: ai-doc-sensecheck)
//   - reconciliation jobs (billing + onboarding activation metrics)
//   - daily ops (audit retention, drift checks)
// Wired in once the first slice that needs it (slice 5) reaches its tasks.
// export const workersAPI = new sst.aws.ApiGatewayV2("api-workers");
// workersAPI.route("$default", "microservices/workers/src/api.handler");

// Authorisers (WorkOS session) attached on per-route basis from
// microservices/core/src/middleware once auth-and-orgs T-007+ lands.
