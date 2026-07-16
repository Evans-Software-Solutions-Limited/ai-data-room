// Tenant-isolation (slice 10) / T-007 — the defence-in-depth alarm signal.
//
// The application-layer factory (ADR-011 Option B) makes cross-tenant queries
// impossible by construction; this is the tripwire for the case where a caller
// nonetheless reaches a scoped WRITE with an explicit foreign `org_id` — the
// one place the runtime guard actively CATCHES a cross-tenant attempt rather
// than silently filtering it (`ScopedRepo.stampOrgId`). In steady state this
// metric is 0; any non-zero value is a P1 — either a real isolation bug that
// the factory caught before it could persist, or an attack probing the write
// path. The `tenancy.guard.violations > 0` alarm in `infra/observability.ts`
// pages on it.
//
// Emits a metric (drives the alarm) + a structured error log (gives the
// on-call the bound vs attempted org for triage). It deliberately does NOT
// write an audit event from here: this module is infrastructure, and the
// `auth-and-orgs` audit writer is application-layer — reaching up to it would
// invert the dependency direction. The actor/request-context-bearing audit
// emission (FR8) belongs at the request boundary that has that context; see
// the slice sign-off (T-008) for FR8's status.

import { logger } from "../logging/logger";
import { emitCount } from "./metrics";

/** CloudWatch metric name — must match the alarm in `infra/observability.ts`. */
export const TENANCY_GUARD_VIOLATIONS_METRIC = "tenancy.guard.violations";

export interface TenancyGuardViolation {
  /** The org the repo was bound to (the caller's real tenant). */
  boundOrgId: string;
  /** The foreign `org_id` the write payload tried to carry. */
  attemptedOrgId: string;
  /** The concrete scoped repo that caught it (`MembershipRepo`, …) — the
   *  triage discriminator for WHICH table's write was attempted, since every
   *  catch today is a write via `stampOrgId`. */
  repo: string;
  /** What was attempted — `"write"` for a `stampOrgId` mismatch today. */
  operation: string;
}

/**
 * Record a caught cross-tenant attempt: bump `tenancy.guard.violations` and
 * log the bound-vs-attempted orgs + the repo that caught it. Called from
 * `ScopedRepo.stampOrgId` right before it throws, so the operator signal fires
 * whether or not the throw is later swallowed upstream. (Actor / request
 * context is deliberately absent — this is infrastructure; the FR8
 * actor-tagged audit event belongs at the application boundary that has it.)
 */
export function recordTenancyGuardViolation(v: TenancyGuardViolation): void {
  emitCount(TENANCY_GUARD_VIOLATIONS_METRIC);
  logger.error("tenancy.guard.violation", {
    boundOrgId: v.boundOrgId,
    attemptedOrgId: v.attemptedOrgId,
    repo: v.repo,
    operation: v.operation,
  });
}
