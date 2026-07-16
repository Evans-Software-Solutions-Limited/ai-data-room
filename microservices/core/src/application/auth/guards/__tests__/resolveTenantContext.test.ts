// Tenant-isolation (slice 10) / T-002 — resolveTenantContext guard.
//
// Two layers of assertion:
//   1. The guard in isolation — it produces a TenantContext from a resolved
//      actor and defends the (in-practice unreachable) null-org branch.
//   2. The mounted chain end-to-end — a
//      `.resolve(actor) → .onBeforeHandle(requireOrg) → .resolve(guard)`
//      bundle mirroring `protectedRoutes.ts`'s `orgScopedRoutes` proves that a
//      provisioned actor gets `tenant` injected into context, and an org-less
//      actor is 403'd before any handler runs. Note it does NOT discriminate
//      the guard *order*: `requireOrg` and `resolveTenantContext` return the
//      identical `403 no_org_membership` on a null org (deliberately — a
//      mis-order degrades to the same safe rejection, so it can't leak), which
//      is precisely why no test at this layer can tell the two orderings
//      apart. The order itself is enforced structurally by the guard sequence
//      in `protectedRoutes.ts`.

import { describe, expect, it } from "vitest";
import Elysia from "elysia";

import { requireOrg } from "../requireOrg";
import { resolveTenantContext } from "../resolveTenantContext";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "99999999-9999-4999-8999-999999999999";

describe("resolveTenantContext (unit)", () => {
  it("injects a TenantContext carrying the actor's local org", () => {
    const result = resolveTenantContext({
      actor: { localUserId: USER_A, localOrgId: ORG_A },
    });

    expect(result).toEqual({ tenant: { localOrgId: ORG_A } });
  });

  it("403s (belt-and-braces) if it somehow runs before an org is resolved", () => {
    const result = resolveTenantContext({
      actor: { localUserId: USER_A, localOrgId: null },
    });

    // Same `status(403, body)` shape requireOrg returns — the reason is
    // deliberately identical so a mis-ordering degrades to requireOrg's 403.
    expect(result).toMatchObject({
      code: 403,
      response: { ok: false, reason: "no_org_membership" },
    });
  });
});

describe("resolveTenantContext (mounted chain — mirrors orgScopedRoutes)", () => {
  // Reproduces the exact guard sequence `protectedRoutes.ts` mounts, minus
  // the WorkOS-backed requireAuth/resolveActor prefix (stubbed by injecting
  // `actor` directly). A `/probe` route echoes whatever `tenant` landed in
  // context so we can assert it was injected for a provisioned actor and that
  // an org-less actor never reaches the handler. (See the file header: this
  // does not — cannot — discriminate the guard order, only the behaviour.)
  function bundle(localOrgId: string | null) {
    return new Elysia()
      .resolve(() => ({ actor: { localUserId: USER_A, localOrgId } }))
      .onBeforeHandle(requireOrg)
      .resolve(resolveTenantContext)
      .get("/probe", (ctx) => {
        const { tenant } = ctx as typeof ctx & {
          tenant?: { localOrgId: string };
        };
        return { localOrgId: tenant?.localOrgId ?? null };
      });
  }

  it("injects tenant into context for a provisioned actor (guard runs after requireOrg)", async () => {
    const res = await bundle(ORG_A).handle(
      new Request("http://localhost/probe"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ localOrgId: ORG_A });
  });

  it("requireOrg 403s an org-less actor before resolveTenantContext runs", async () => {
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
