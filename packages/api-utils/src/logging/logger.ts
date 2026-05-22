import { Logger } from "@aws-lambda-powertools/logger";
import type { Context } from "aws-lambda";

/**
 * Structured logger factory using AWS Lambda Powertools.
 *
 * Creates a Logger instance configured for the given service name.
 * Each Lambda should call this once at module scope and reuse across invocations.
 *
 * Configuration is driven by environment variables (set in infra/api.ts):
 * - POWERTOOLS_SERVICE_NAME — identifies the Lambda in log output
 * - POWERTOOLS_LOG_LEVEL — INFO (production), DEBUG (dev/staging)
 * - POWERTOOLS_LOGGER_SAMPLE_RATE — optional, for production debug sampling
 *
 * @example
 * ```ts
 * import { createLogger } from "@ai-data-room/api-utils/logging";
 * const logger = createLogger("core-api");
 * logger.info("Server started", { port: 3000 });
 * ```
 */
export function createLogger(serviceName?: string): Logger {
  return new Logger({ serviceName });
}

/**
 * Injects Lambda context into the logger instance.
 *
 * Call at the top of every raw Lambda handler (webhook handlers, SQS processors)
 * to auto-populate: function_name, function_version, function_memory_size,
 * aws_request_id, cold_start, xray_trace_id.
 */
export function injectLambdaContext(logger: Logger, context: Context): void {
  logger.addContext(context);
}

/**
 * Serialises an error for structured logging.
 * Preserves the stack trace as a single field — never split across log records.
 */
export function serializeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: "UnknownError",
    message: String(error),
  };
}

// Re-export the Logger type for consumers that need to type function parameters.
export type { Logger } from "@aws-lambda-powertools/logger";
