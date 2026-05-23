// Per-IP rate-limit Elysia plugin for the public auth surface
// (NFR4: 10 attempts/IP/minute on the login endpoints).
//
// The store is in-memory per Lambda instance — multiple concurrent
// Lambdas each hold their own counter, so the effective per-IP cap
// is `LIMIT * N_instances`. Acceptable for v0.1 traffic; Phase 2
// swaps the store for DynamoDB or ElastiCache so the counter is
// shared. See `docs/security.md` for the full operating envelope.
//
// AuthKit owns the actual login flow (we never see passwords or the
// target email until AuthKit has validated the code), so the
// "per-target-email" half of NFR4 is delegated upstream.

import Elysia from "elysia";

import { emitCount } from "../infrastructure/observability/metrics";

export interface RateLimitConfig {
  /** Max requests allowed per IP per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Suffix on the `auth.rate_limit.<label>.blocked` metric. */
  metricLabel?: string;
}

/** NFR4: 10 requests per IP per minute on login attempts. */
export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 60_000,
};

type Hit = { count: number; resetAt: number };

export function rateLimit(config: RateLimitConfig) {
  const store = new Map<string, Hit>();
  const metricLabel = config.metricLabel ?? "auth";

  return new Elysia({ name: `rate-limit-${metricLabel}` }).onRequest(
    ({ request, set }) => {
      const ip = extractClientIp(request);
      const now = Date.now();
      const existing = store.get(ip);

      // O(1) cleanup of just the entry we're about to touch. A
      // periodic sweep would be more thorough but isn't worth it at
      // this scale — even a million unique IPs is a few MB.
      if (existing && existing.resetAt <= now) {
        store.delete(ip);
      }

      const current = store.get(ip) ?? {
        count: 0,
        resetAt: now + config.windowMs,
      };
      current.count += 1;
      store.set(ip, current);

      const remaining = Math.max(0, config.limit - current.count);
      const retryAfterSec = Math.max(
        1,
        Math.ceil((current.resetAt - now) / 1000),
      );

      set.headers["x-ratelimit-limit"] = String(config.limit);
      set.headers["x-ratelimit-remaining"] = String(remaining);
      set.headers["x-ratelimit-reset"] = String(
        Math.floor(current.resetAt / 1000),
      );

      if (current.count > config.limit) {
        emitCount(`auth.rate_limit.${metricLabel}.blocked`);
        set.headers["retry-after"] = String(retryAfterSec);
        set.status = 429;
        return {
          ok: false as const,
          reason: "rate_limited" as const,
        };
      }
    },
  );
}

function extractClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const leftmost = forwarded.split(",")[0]?.trim();
    if (leftmost) return leftmost;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
