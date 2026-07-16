// resolveScopedRepos — Elysia `.resolve()` guard that builds the
// request's tenant-scoped repo bundle (FR3) and injects it as
// `ctx.scoped`. Mounted in `protectedRoutes.ts`'s `orgScopedRoutes`
// chain immediately AFTER `resolveTenantContext`, so every org-scoped
// handler can read `ctx.scoped.<repo>` instead of constructing its
// own (unscoped) repo instance.
//
// Tenant-isolation (slice 10) / T-004. Mirrors `resolveTenantContext`'s
// shape: `requireOrg` already asserted a non-null `actor.localOrgId`
// earlier in the same chain, and `resolveTenantContext` already 403s
// on that same null case — so the null branch below is belt-and-
// braces, not the expected path. It exists so a future re-ordering of
// the guard chain fails safe (403) rather than constructing a scoped
// bundle with a bogus/absent org.

import { status } from "elysia";
import type { DbOrTx } from "@ai-data-room/db";

import {
  scopedRepo,
  type ScopedRepos,
} from "../../../infrastructure/db/scoped";
import type { ActorContext } from "./authContextTypes";

export function createScopedReposGuard(db: DbOrTx) {
  return function resolveScopedRepos(ctx: Record<string, unknown>) {
    // Same cast pattern as `requireOrg` / `resolveTenantContext`: the
    // standalone guard's typed surface can't see the bundle's prior
    // `.resolve(resolveActor)` injection, so we narrow here (FDP
    // convention).
    const { actor } = ctx as typeof ctx & { actor: ActorContext["actor"] };

    if (!actor.localOrgId) {
      return status(403, {
        ok: false as const,
        reason: "no_org_membership" as const,
      });
    }

    const scoped: ScopedRepos = scopedRepo(actor.localOrgId, db);
    return { scoped };
  };
}
