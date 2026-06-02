// Core API. Layered architecture per CLAUDE.md §Repo layout:
//   src/
//     handlers/<slice>/*.ts      — HTTP routes; Zod-validated
//     application/<slice>/*.ts   — use cases; pure functions
//     domain/<slice>/*.ts        — types, invariants, enums
//     infrastructure/
//       db/<slice>/*.ts          — typed repos calling @ai-data-room/db
//       workos/*.ts              — WorkOS SDK wrappers (slice 1)
//       stripe/*.ts              — Stripe SDK wrappers (slice 8)
//       anthropic/*.ts           — Anthropic SDK wrappers (slices 5 + 6)
//     middleware/                — requires(), requireWritesEnabled, etc.

import Elysia from "elysia";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import type { Context } from "aws-lambda";
import openapi from "@elysiajs/openapi";
import {
  injectLambdaContext,
  loggerPlugin,
} from "@ai-data-room/api-utils/logging";

import { logger } from "./infrastructure/logging/logger";
import { flushMetrics } from "./infrastructure/observability/metrics";
import { protectedRoutes } from "./application/auth/protectedRoutes";
import { publicRoutes } from "./application/auth/publicRoutes";
import { orgRoutes } from "./application/orgs/orgRoutes";
import { getHelloWorldHandler } from "./application/hello-world/get/helloWorldGetHandler";

// `loggerPlugin` must run before any other `.use()` so its `.derive()` lands
// the per-request child logger into context before route handlers fire.
const app = new Elysia()
  .use(loggerPlugin(logger))
  .use(openapi())
  .use(getHelloWorldHandler)
  .use(publicRoutes)
  .use(orgRoutes)
  .use(protectedRoutes);

export type CoreApi = typeof app;

const honoApp = new Hono().mount("/", app.fetch);
const honoHandler = handle(honoApp);

export const handler = async (
  event: Parameters<typeof honoHandler>[0],
  context: Context,
) => {
  injectLambdaContext(logger, context);
  try {
    return await honoHandler(event, context);
  } finally {
    // Coalesce every metric emitted during this invocation into a
    // single EMF log line. `try/finally` so a thrown handler still
    // publishes the metrics it managed to add (notably the
    // `auth.audit.write_failure` count).
    flushMetrics();
  }
};
