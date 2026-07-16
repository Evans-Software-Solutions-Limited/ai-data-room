// resolveTenantContext — Elysia `.resolve()` guard that lifts the caller's
// local org UUID into a request-scoped `TenantContext` (FR1), making the
// tenant scope available to the data-access layer for the lifetime of the
// request. Mirrors FDP's `guards/resolveTenant.ts`.
//
// Tenant-isolation (slice 10) / T-002. Mounted in `protectedRoutes.ts`'s
// `orgScopedRoutes` bundle AFTER `requireOrg`, so by the time it runs
// `actor.localOrgId` is already asserted non-null. The null branch below is
// therefore a belt-and-braces guard, not the expected path — it returns the
// same 403 shape `requireOrg` uses so a mis-ordering can never silently
// produce a context with a bogus org. `/me` deliberately does NOT mount this
// (it serves org-less users), so nothing here runs for the unprovisioned
// shape.
//
// The injected `tenant` is what a later-slice handler passes straight to
// `scopedRepo(tenant.localOrgId, db)`. No slice-1 handler consumes it yet;
// `room-and-folders` is the first.

import { status } from "elysia";

import { tenantContext } from "../../../infrastructure/db/scoped";
import type { ActorContext } from "./authContextTypes";

export function resolveTenantContext(ctx: Record<string, unknown>) {
  // Same cast pattern as `requireOrg` / the handler bodies: the standalone
  // guard's typed surface can't see the bundle's prior `.resolve(resolveActor)`
  // injection, so we narrow here (FDP convention).
  const { actor } = ctx as typeof ctx & { actor: ActorContext["actor"] };

  if (!actor.localOrgId) {
    return status(403, {
      ok: false as const,
      reason: "no_org_membership" as const,
    });
  }

  return { tenant: tenantContext(actor.localOrgId) };
}
