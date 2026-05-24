// Per-IP rate-limit Elysia plugin for the public auth surface
// (NFR4: 10 attempts/IP/minute on the login endpoints).
//
// IP extraction takes the **rightmost** entry of `x-forwarded-for`,
// not the leftmost. API Gateway HTTP API v2 *appends* the real TCP
// source IP to whatever the client sent — it does not replace it.
// The leftmost value is client-controlled and a per-request random
// would defeat the cap entirely. The rightmost value is the one API
// Gateway wrote and clients cannot forge.
//
// When no XFF header is present we refuse to make a rate-limit
// decision (503) rather than collapse every IP-less request into a
// single shared bucket — a misconfigured internal caller without
// the header would otherwise be able to lock out every other such
// caller with 10 req/min.
//
// The store is in-memory per Lambda instance — multiple concurrent
// Lambdas each hold their own counter, so the effective per-IP cap
// is `LIMIT * N_instances`. Acceptable for v0.1 traffic; Phase 2
// swaps the store for DynamoDB or ElastiCache so the counter is
// shared. The Map is bounded at `MAX_STORE_ENTRIES` and evicts the
// oldest-resetAt entry when full, so a botnet rotating real IPs
// can't grow the Map unboundedly and OOM the Lambda.
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

/** Memory ceiling on the per-Lambda Map. At ~150 bytes/entry this is
 * ~1.5 MB — well below the 512 MB Lambda memory cap with plenty of
 * head-room for the rest of the request. Once exceeded we evict the
 * entry with the soonest `resetAt`: it would have expired anyway
 * and dropping it just means the legitimate visitor gets their full
 * budget back a few seconds early. */
const MAX_STORE_ENTRIES = 10_000;

type Hit = { count: number; resetAt: number };

export function rateLimit(config: RateLimitConfig) {
  const store = new Map<string, Hit>();
  const metricLabel = config.metricLabel ?? "auth";

  return new Elysia({ name: `rate-limit-${metricLabel}` }).onRequest(
    ({ request, set }) => {
      const ip = extractClientIp(request);
      if (ip === null) {
        // No trustworthy IP — refuse to process rather than rate-
        // limit against the wrong bucket. Production traffic
        // always carries an XFF (API Gateway appends to it); this
        // branch only fires for direct-to-Lambda calls without
        // the gateway in front, which we don't run in prod.
        //
        // `set.status + return body` (not `status(503, ...)`)
        // because Elysia plugins' `onRequest` short-circuit
        // unwraps a returned plain object directly into the
        // response body but doesn't unwrap an
        // `ElysiaCustomStatusResponse` from `status()` — verified
        // on Elysia 1.4 via the `elysia-shortcircuit-probe`
        // unit test sibling.
        emitCount(`auth.rate_limit.${metricLabel}.no_ip`);
        set.status = 503;
        return {
          ok: false as const,
          reason: "ip_unavailable" as const,
        };
      }

      const now = Date.now();
      const existing = store.get(ip);

      // O(1) cleanup of just the entry we're about to touch.
      if (existing && existing.resetAt <= now) {
        store.delete(ip);
      }

      const current = store.get(ip) ?? {
        count: 0,
        resetAt: now + config.windowMs,
      };
      current.count += 1;
      store.set(ip, current);

      // Bounded eviction: if we just pushed the Map over the cap,
      // drop whichever entry expires soonest. Linear in the Map
      // size — runs only when at the cap, so amortised cost is
      // negligible.
      if (store.size > MAX_STORE_ENTRIES) {
        evictSoonestExpiring(store);
      }

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

/**
 * Returns the rightmost non-empty entry of `x-forwarded-for` (the
 * IP API Gateway HTTP API v2 wrote — clients can't forge it because
 * the gateway appends, never replaces). Returns `null` if no XFF
 * header is present.
 */
function extractClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return null;

  const parts = forwarded.split(",");
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts[i]?.trim();
    if (candidate) return candidate;
  }
  return null;
}

function evictSoonestExpiring(store: Map<string, Hit>): void {
  let oldestKey: string | undefined;
  let oldestResetAt = Infinity;
  for (const [key, hit] of store) {
    if (hit.resetAt < oldestResetAt) {
      oldestResetAt = hit.resetAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== undefined) store.delete(oldestKey);
}
