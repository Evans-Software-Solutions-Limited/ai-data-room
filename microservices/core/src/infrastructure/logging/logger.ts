import { createLogger } from "@ai-data-room/api-utils/logging";

// Singleton so `injectLambdaContext(logger, context)` from the
// Lambda entrypoint propagates `aws_request_id`, `cold_start`, etc.
// to every downstream log line in the same invocation. Service name
// comes from `POWERTOOLS_SERVICE_NAME` in `infra/api.ts`.
export const logger = createLogger();
