import { Tracer } from "@aws-lambda-powertools/tracer";

// Tracer is a no-op unless the Lambda has `tracingConfig.mode =
// "Active"` set (see `infra/api.ts`). Handlers tag spans via
// `tracer.putAnnotation(...)`; design.md §Observability tags are
// `userId` / `orgId` / `eventType`.
export const tracer = new Tracer();
