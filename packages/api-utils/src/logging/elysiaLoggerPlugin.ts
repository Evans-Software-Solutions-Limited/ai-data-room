import Elysia from "elysia";
import type { Logger } from "@aws-lambda-powertools/logger";

import { serializeError } from "./logger";

/**
 * Elysia plugin that provides structured request/response logging via
 * AWS Lambda Powertools Logger.
 *
 * Emits:
 * - `request.start` on every inbound request (method, path)
 * - `request.end` on every completed response (status, duration)
 * - `request.error` on unhandled errors (full stack trace preserved)
 *
 * Derives a `logger` instance into the Elysia context so route handlers
 * and downstream plugins can call `ctx.logger.info(...)` with request
 * context already attached.
 *
 * Must be the FIRST `.use()` in the Elysia app so that `.derive` runs before
 * any route handler.
 *
 * @example
 * ```ts
 * import { createLogger, loggerPlugin } from "@ai-data-room/api-utils/logging";
 *
 * const logger = createLogger("core-api");
 * const app = new Elysia()
 *   .use(loggerPlugin(logger))
 *   .use(publicRoutes)
 *   .use(protectedRoutes);
 * ```
 */

/**
 * Resolves Elysia's `set.status` to a numeric HTTP status code.
 * Elysia allows both numeric (200) and string ("404") status values.
 */
export function resolveStatusCode(status: unknown, fallback: number): number {
  if (typeof status === "number") return status;
  if (typeof status === "string") {
    const parsed = Number(status);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function loggerPlugin(logger: Logger) {
  // WeakMap to track request-scoped state across lifecycle hooks.
  // Elysia guarantees .derive() runs before onAfterHandle/onError,
  // so the state will always be present when these hooks fire.
  const requestState = new WeakMap<
    Request,
    { logger: Logger; startTime: number }
  >();

  return new Elysia({ name: "logger-plugin" })
    .derive({ as: "global" }, ({ request }) => {
      const startTime = performance.now();
      const url = new URL(request.url);

      // Reset any request-scoped keys from the previous invocation to prevent
      // cross-request context leakage in warm Lambda instances.
      logger.resetKeys();

      const requestLogger = logger.createChild({
        persistentLogAttributes: {
          method: request.method,
          path: url.pathname,
        },
      });

      requestLogger.info("request.start", {
        method: request.method,
        path: url.pathname,
      });

      requestState.set(request, { logger: requestLogger, startTime });

      return {
        logger: requestLogger,
      };
    })
    .onAfterHandle({ as: "global" }, ({ request, set }) => {
      const state = requestState.get(request);
      if (!state) return;

      const duration = Math.round(performance.now() - state.startTime);
      const statusCode = resolveStatusCode(set.status, 200);

      state.logger.info("request.end", {
        status_code: statusCode,
        duration_ms: duration,
      });

      requestState.delete(request);
    })
    .onError({ as: "global" }, ({ error, request, set }) => {
      const state = requestState.get(request);
      const duration = state
        ? Math.round(performance.now() - state.startTime)
        : 0;
      const statusCode = resolveStatusCode(set.status, 500);
      const targetLogger = state?.logger ?? logger;

      targetLogger.error("request.error", {
        status_code: statusCode,
        duration_ms: duration,
        error: serializeError(error),
      });

      requestState.delete(request);
    });
}
