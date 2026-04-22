// Workers surface — **status: stub.** This microservice is slice-5
// infra (`ai-doc-sensecheck` wires an SQS consumer here). Nothing
// upstream currently imports a handler from this file, and
// `sst.config.ts` does not link a worker Lambda yet — see the
// commented `workersAPI` block in `infra/api.ts`.
//
// The scaffold previously imported `elysia` / `hono` / `@elysiajs/openapi`
// without declaring them in `package.json`, which made `bun run
// typecheck` fail in CI. That violates the "we always use typecheck,
// lint and prettier to stick to a strong guardrail" rule, so we
// collapsed the surface to a bare stub until slice 5 picks it up and
// declares the right deps + registers the handler through SST. Matches
// the "declare when shipped" convention used for `infra/storage.ts`
// and the WorkOS secret ledger in `infra/secrets.ts`.
//
// When slice 5 lands, restore an SQS event handler here — e.g.:
//   import type { SQSHandler } from "aws-lambda";
//   export const handler: SQSHandler = async (event) => { ... };

export {};
