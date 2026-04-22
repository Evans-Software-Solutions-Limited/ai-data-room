// Placeholder worker handler — flesh out when slice 5 (ai-doc-sensecheck)
// wires its SQS consumer. The worker surface is _not_ a public HTTP API;
// keeping a tiny healthz app for smoke tests and operational poking.

import Elysia from "elysia";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import openapi from "@elysiajs/openapi";

const app = new Elysia().use(openapi()).get("/healthz", () => ({
  ok: true,
  service: "workers",
  // Deliberately terse — this endpoint is never part of the product API.
}));

export type WorkersApi = typeof app;
export const handler = handle(new Hono().mount("/", app.fetch));
