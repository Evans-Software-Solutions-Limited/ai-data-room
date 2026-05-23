// Unit tests for the per-IP rate-limit plugin.
//
// Built around a small Elysia app that mounts the plugin + a single
// GET route, so each test fires N requests and asserts the response
// shape + headers transition cleanly from 200 → 429 at the
// configured limit.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Elysia from "elysia";

import { metrics } from "../../infrastructure/observability/metrics";
import { rateLimit } from "../rateLimit";

const CONFIG = { limit: 3, windowMs: 60_000 };

function makeApp() {
  return new Elysia().use(rateLimit(CONFIG)).get("/auth/sign-in", () => "ok");
}

function makeRequest(ip: string | undefined = "203.0.113.5"): Request {
  const headers: Record<string, string> = {};
  if (ip) headers["x-forwarded-for"] = ip;
  return new Request("http://localhost/auth/sign-in", { headers });
}

describe("rateLimit", () => {
  beforeEach(() => {
    vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows requests up to the configured limit", async () => {
    const app = makeApp();
    for (let i = 0; i < CONFIG.limit; i++) {
      const res = await app.handle(makeRequest());
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 + rate_limited body on the request that exceeds the limit", async () => {
    const app = makeApp();
    for (let i = 0; i < CONFIG.limit; i++) {
      await app.handle(makeRequest());
    }
    const res = await app.handle(makeRequest());

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, reason: "rate_limited" });
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("exposes the budget on every response via x-ratelimit headers", async () => {
    const app = makeApp();
    const first = await app.handle(makeRequest());
    expect(first.headers.get("x-ratelimit-limit")).toBe("3");
    expect(first.headers.get("x-ratelimit-remaining")).toBe("2");
    expect(first.headers.get("x-ratelimit-reset")).toMatch(/^\d+$/);

    await app.handle(makeRequest());
    const third = await app.handle(makeRequest());
    expect(third.headers.get("x-ratelimit-remaining")).toBe("0");
  });

  it("tracks each IP independently (cross-IP requests don't pool)", async () => {
    const app = makeApp();
    for (let i = 0; i < CONFIG.limit; i++) {
      await app.handle(makeRequest("198.51.100.1"));
    }
    // The first IP is now at the cap. A different IP should still
    // be at full budget — the store keys on IP.
    const res = await app.handle(makeRequest("198.51.100.2"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-remaining")).toBe("2");
  });

  it("resets the counter once the window has elapsed", async () => {
    vi.useFakeTimers();
    const app = makeApp();
    for (let i = 0; i < CONFIG.limit; i++) {
      await app.handle(makeRequest());
    }
    // One past the limit → blocked.
    const blocked = await app.handle(makeRequest());
    expect(blocked.status).toBe(429);

    // Fast-forward past the window. The next request lands a fresh
    // budget because the cleanup branch sees `resetAt <= now`.
    vi.advanceTimersByTime(CONFIG.windowMs + 1);
    const allowed = await app.handle(makeRequest());
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("x-ratelimit-remaining")).toBe("2");
    vi.useRealTimers();
  });

  it("emits the rate_limit blocked metric only on denied requests", async () => {
    const app = makeApp();
    for (let i = 0; i < CONFIG.limit; i++) {
      await app.handle(makeRequest());
    }
    expect(metrics.addMetric).not.toHaveBeenCalledWith(
      "auth.rate_limit.auth.blocked",
      expect.anything(),
      expect.anything(),
    );
    await app.handle(makeRequest());
    expect(metrics.addMetric).toHaveBeenCalledWith(
      "auth.rate_limit.auth.blocked",
      expect.anything(),
      1,
    );
  });

  it("uses the leftmost IP from x-forwarded-for (real client, not proxies)", async () => {
    const app = makeApp();
    for (let i = 0; i < CONFIG.limit; i++) {
      await app.handle(makeRequest("203.0.113.5, 70.41.3.18"));
    }
    // Same client behind the same proxy chain → should be capped.
    const res = await app.handle(makeRequest("203.0.113.5, 70.41.3.18"));
    expect(res.status).toBe(429);
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const app = new Elysia()
      .use(rateLimit(CONFIG))
      .get("/auth/sign-in", () => "ok");
    for (let i = 0; i < CONFIG.limit; i++) {
      const req = new Request("http://localhost/auth/sign-in", {
        headers: { "x-real-ip": "192.0.2.10" },
      });
      await app.handle(req);
    }
    const blocked = await app.handle(
      new Request("http://localhost/auth/sign-in", {
        headers: { "x-real-ip": "192.0.2.10" },
      }),
    );
    expect(blocked.status).toBe(429);
  });

  it("treats requests with no IP headers as a single 'unknown' bucket", async () => {
    // Defensive — malformed proxy chain shouldn't short-circuit the
    // route; it should slot into a shared 'unknown' counter that
    // still gets rate-limited so a misconfigured upstream can't
    // become a free bypass.
    const app = makeApp();
    for (let i = 0; i < CONFIG.limit; i++) {
      await app.handle(makeRequest(undefined));
    }
    const blocked = await app.handle(makeRequest(undefined));
    expect(blocked.status).toBe(429);
  });
});
