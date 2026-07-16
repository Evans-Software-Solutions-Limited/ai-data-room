// Tenant-isolation (slice 10) / T-004 — resolveScopedRepos guard.
//
// Mirrors `resolveTenantContext.test.ts`'s two-layer shape:
//   1. The guard in isolation — it builds a `ScopedRepos` bundle from a
//      resolved actor and defends the (in-practice unreachable) null-org
//      branch, same belt-and-braces rationale as `resolveTenantContext`.
//   2. The mounted chain end-to-end — a
//      `.resolve(actor) → .onBeforeHandle(requireOrg) → .resolve(tenant) →
//      .resolve(scopedRepos)` bundle mirroring `protectedRoutes.ts`'s
//      `orgScopedRoutes` proves a provisioned actor gets `ctx.scoped`
//      injected, bound to their org.
//
// A plain truthy object stands in for `db` — `createScopedReposGuard` only
// constructs the scoped repo bundle, it never issues a query, so no real
// Drizzle handle is needed here (same reasoning as `scoped.test.ts`'s
// `fakeDb`).

import { describe, expect, it } from "vitest";
import Elysia from "elysia";
import type { DbOrTx } from "@ai-data-room/db";

import { requireOrg } from "../requireOrg";
import { createScopedReposGuard } from "../resolveScopedRepos";
import { resolveTenantContext } from "../resolveTenantContext";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "99999999-9999-4999-8999-999999999999";

const fakeDb = {} as DbOrTx;

describe("resolveScopedRepos (unit)", () => {
  it("injects a ScopedRepos bundle bound to the actor's local org", () => {
    const resolveScopedRepos = createScopedReposGuard(fakeDb);
    const result = resolveScopedRepos({
      actor: { localUserId: USER_A, localOrgId: ORG_A },
    });

    expect(result).toMatchObject({
      scoped: {
        membership: expect.objectContaining({ scopeOrgId: ORG_A }),
        invitations: expect.objectContaining({ scopeOrgId: ORG_A }),
        externalGrants: expect.objectContaining({ scopeOrgId: ORG_A }),
        auditReads: expect.objectContaining({ scopeOrgId: ORG_A }),
      },
    });
  });

  it("403s (belt-and-braces) if it somehow runs before an org is resolved", () => {
    const resolveScopedRepos = createScopedReposGuard(fakeDb);
    const result = resolveScopedRepos({
      actor: { localUserId: USER_A, localOrgId: null },
    });

    // Same `status(403, body)` shape requireOrg / resolveTenantContext
    // return — deliberately identical so a mis-ordering degrades to the
    // same safe rejection rather than constructing a bogus scope.
    expect(result).toMatchObject({
      code: 403,
      response: { ok: false, reason: "no_org_membership" },
    });
  });
});

describe("resolveScopedRepos (mounted chain — mirrors orgScopedRoutes)", () => {
  // Reproduces the guard sequence `protectedRoutes.ts` mounts after
  // requireAuth/resolveActor (stubbed by injecting `actor` directly): a
  // `/probe` route echoes the bound org off `ctx.scoped.membership`.
  function bundle(localOrgId: string | null) {
    return new Elysia()
      .resolve(() => ({ actor: { localUserId: USER_A, localOrgId } }))
      .onBeforeHandle(requireOrg)
      .resolve(resolveTenantContext)
      .resolve(createScopedReposGuard(fakeDb))
      .get("/probe", (ctx) => {
        const { scoped } = ctx as typeof ctx & {
          scoped?: { membership: { scopeOrgId: string } };
        };
        return { boundOrgId: scoped?.membership.scopeOrgId ?? null };
      });
  }

  it("injects ctx.scoped for a provisioned actor (guard runs after requireOrg + tenant context)", async () => {
    const res = await bundle(ORG_A).handle(
      new Request("http://localhost/probe"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ boundOrgId: ORG_A });
  });

  it("requireOrg 403s an org-less actor before resolveScopedRepos runs", async () => {
    const res = await bundle(null).handle(
      new Request("http://localhost/probe"),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      ok: false,
      reason: "no_org_membership",
    });
  });
});
