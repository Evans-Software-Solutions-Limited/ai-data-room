import { describe, it, expect, vi, beforeEach } from "vitest";
import Elysia from "elysia";
import type { Logger } from "@aws-lambda-powertools/logger";

import { createLogger } from "../logger";
import { loggerPlugin, resolveStatusCode } from "../elysiaLoggerPlugin";

describe("elysiaLoggerPlugin", () => {
  let logger: Logger;
  let childLogger: Logger;
  let childInfoSpy: ReturnType<typeof vi.fn>;
  let childErrorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = createLogger("test-service");

    childInfoSpy = vi.fn();
    childErrorSpy = vi.fn();

    childLogger = {
      info: childInfoSpy,
      error: childErrorSpy,
      warn: vi.fn(),
      debug: vi.fn(),
      appendKeys: vi.fn(),
      createChild: vi.fn(),
    } as unknown as Logger;

    vi.spyOn(logger, "createChild").mockReturnValue(childLogger);
  });

  it("emits request.start on inbound request", async () => {
    const app = new Elysia().use(loggerPlugin(logger)).get("/test", () => "ok");

    const response = await app.handle(new Request("http://localhost/test"));

    expect(response.status).toBe(200);
    expect(childInfoSpy).toHaveBeenCalledWith(
      "request.start",
      expect.objectContaining({
        method: "GET",
        path: "/test",
      }),
    );
  });

  it("emits request.end after response", async () => {
    const app = new Elysia().use(loggerPlugin(logger)).get("/test", () => "ok");

    await app.handle(new Request("http://localhost/test"));

    expect(childInfoSpy).toHaveBeenCalledWith(
      "request.end",
      expect.objectContaining({
        status_code: 200,
        duration_ms: expect.any(Number),
      }),
    );
  });

  it("emits request.error on unhandled error", async () => {
    const app = new Elysia().use(loggerPlugin(logger)).get("/fail", () => {
      throw new Error("Boom");
    });

    const response = await app.handle(new Request("http://localhost/fail"));

    expect(response.status).toBe(500);
    expect(childErrorSpy).toHaveBeenCalledWith(
      "request.error",
      expect.objectContaining({
        error: expect.objectContaining({
          name: "Error",
          message: "Boom",
          stack: expect.any(String),
        }),
      }),
    );
  });

  it("derives logger into context for route handlers", async () => {
    let contextLogger: unknown;

    const app = new Elysia().use(loggerPlugin(logger)).get("/ctx", (ctx) => {
      contextLogger = (ctx as unknown as { logger: unknown }).logger;
      return "ok";
    });

    await app.handle(new Request("http://localhost/ctx"));

    expect(contextLogger).toBeDefined();
    expect(contextLogger).toBe(childLogger);
  });

  it("includes duration_ms in request.end", async () => {
    const app = new Elysia()
      .use(loggerPlugin(logger))
      .get("/slow", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "done";
      });

    await app.handle(new Request("http://localhost/slow"));

    const endCall = childInfoSpy.mock.calls.find(
      (call: unknown[]) => call[0] === "request.end",
    );
    expect(endCall).toBeDefined();
    const attrs = endCall![1] as { duration_ms: number };
    // The plugin's contract is "emit a numeric, non-negative elapsed on
    // request.end" — assert exactly that. A specific magnitude (e.g.
    // >= 10 to match the handler's setTimeout(10)) is inherently flaky:
    // wall-clock elapsed is imprecise and setTimeout can fire a hair
    // early, so it intermittently measured 9ms and reddened CI.
    expect(typeof attrs.duration_ms).toBe("number");
    expect(Number.isFinite(attrs.duration_ms)).toBe(true);
    expect(attrs.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("handles non-Error thrown values in onError", async () => {
    const app = new Elysia()
      .use(loggerPlugin(logger))
      .get("/throw-string", () => {
        throw "string error";
      });

    const response = await app.handle(
      new Request("http://localhost/throw-string"),
    );

    expect(response.status).toBe(500);
    expect(childErrorSpy).toHaveBeenCalledWith(
      "request.error",
      expect.objectContaining({
        error: expect.objectContaining({
          name: "UnknownError",
          message: "string error",
        }),
      }),
    );
  });

  it("includes status_code in request.end for non-200 responses", async () => {
    const app = new Elysia()
      .use(loggerPlugin(logger))
      .get("/not-found", ({ set }) => {
        set.status = 404;
        return "not found";
      });

    await app.handle(new Request("http://localhost/not-found"));

    expect(childInfoSpy).toHaveBeenCalledWith(
      "request.end",
      expect.objectContaining({
        status_code: 404,
      }),
    );
  });

  it("defaults to status 200 when set.status is not a number", async () => {
    const app = new Elysia()
      .use(loggerPlugin(logger))
      .get("/default-status", () => "ok");

    await app.handle(new Request("http://localhost/default-status"));

    expect(childInfoSpy).toHaveBeenCalledWith(
      "request.end",
      expect.objectContaining({
        status_code: 200,
      }),
    );
  });

  it("falls back to parent logger when error fires before derive", async () => {
    const parentErrorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    const app = new Elysia()
      .use(loggerPlugin(logger))
      .onParse(() => {
        throw new Error("Parse failure");
      })
      .post("/parse-fail", () => "ok");

    const response = await app.handle(
      new Request("http://localhost/parse-fail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(parentErrorSpy).toHaveBeenCalledWith(
      "request.error",
      expect.objectContaining({
        status_code: expect.any(Number),
        duration_ms: 0,
        error: expect.objectContaining({
          name: expect.any(String),
          message: expect.any(String),
        }),
      }),
    );
    expect(childErrorSpy).not.toHaveBeenCalled();

    parentErrorSpy.mockRestore();
  });
});

describe("resolveStatusCode", () => {
  it("returns the number directly when status is numeric", () => {
    expect(resolveStatusCode(404, 200)).toBe(404);
    expect(resolveStatusCode(500, 200)).toBe(500);
    expect(resolveStatusCode(200, 500)).toBe(200);
  });

  it("parses a numeric string to a number", () => {
    expect(resolveStatusCode("404", 200)).toBe(404);
    expect(resolveStatusCode("500", 200)).toBe(500);
  });

  it("returns fallback for non-numeric strings", () => {
    expect(resolveStatusCode("Not Found", 200)).toBe(200);
    expect(resolveStatusCode("Internal Server Error", 500)).toBe(500);
  });

  it("returns fallback for undefined/null/other types", () => {
    expect(resolveStatusCode(undefined, 200)).toBe(200);
    expect(resolveStatusCode(null, 500)).toBe(500);
    expect(resolveStatusCode({}, 200)).toBe(200);
  });
});
