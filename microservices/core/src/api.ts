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
import openapi from "@elysiajs/openapi";

import { publicRoutes } from "./application/auth/publicRoutes";
import { getHelloWorldHandler } from "./application/hello-world/get/helloWorldGetHandler";
import { healthWorkosGetHandler } from "./handlers/auth/healthWorkosGetHandler";

// Slice handlers are mounted here as they land. One line per slice — the
// handler module owns its own sub-routing.
const app = new Elysia()
  .use(openapi())
  .use(getHelloWorldHandler)
  .use(publicRoutes) // slice 1 T-014a — public auth routes (sign-in / sign-up / callback / sign-out)
  .use(healthWorkosGetHandler); // slice 1 T-002 — REMOVED in T-015
// .use(protectedRoutes)          // slice 1 T-014b / T-015
// .use(orgsHandler)              // slice 1
// .use(roomsHandler)             // slice 2
// .use(accessControlHandler)     // slice 3
// .use(checklistHandler)         // slice 4
// .use(sensecheckHandler)        // slice 5 (public status + admin overrides)
// .use(qnaHandler)               // slice 6
// .use(dashboardHandler)         // slice 7 BFF aggregates
// .use(billingHandler)           // slice 8
// .use(onboardingHandler)        // slice 9

export type CoreApi = typeof app;

export const handler = handle(new Hono().mount("/", app.fetch));
