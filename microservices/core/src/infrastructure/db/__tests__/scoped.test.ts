// Tenant-isolation (slice 10) / T-002 — the scoped-repo mechanism.
//
// Proves the base contract that every tenant-scoped repo inherits, without
// a live DB: reads inject `WHERE org_id = $1`, writes verify + stamp the
// org (and refuse a foreign one), `withTx` preserves the scope, and the
// factory / context reject a missing org. The end-to-end "no cross-tenant
// row against real Postgres" guarantee is the property test (T-006); this
// file locks the unit-level invariants of the machinery itself.

import { describe, expect, it } from "vitest";
import { eq, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { schema } from "@ai-data-room/db";
import type { DbOrTx, Tx } from "@ai-data-room/db";

import {
  ScopedRepo,
  ScopedRepoError,
  scopedRepo,
  tenantContext,
  type OrgId,
} from "../scoped";

const { auditEvents } = schema;

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

// A minimal concrete repo so the abstract base's contract can be exercised
// directly. Deliberately test-only — the real repos land in T-004. It uses
// `audit_events` (a real tenant-scoped table) so the rendered SQL is honest.
class FixtureRepo extends ScopedRepo {
  withTx(tx: Tx): FixtureRepo {
    return new FixtureRepo(tx, this.orgId);
  }
  readPredicate(extra?: SQL): SQL {
    return this.scoped(auditEvents.orgId, extra);
  }
  stamp<T>(values: T): T & { orgId: OrgId } {
    return this.stampOrgId(values);
  }
}

// Any truthy object satisfies the `db` guard — the base never queries it in
// these unit tests, it only threads it. A real Drizzle handle isn't needed.
const fakeDb = {} as DbOrTx;

/** Render a predicate to SQL + params using drizzle's connection-less
 *  QueryBuilder, so we can assert what actually reaches Postgres. */
function renderWhere(predicate: SQL): { sql: string; params: unknown[] } {
  return new QueryBuilder().select().from(auditEvents).where(predicate).toSQL();
}

describe("ScopedRepo — construction guards", () => {
  it("rejects an empty orgId", () => {
    expect(() => new FixtureRepo(fakeDb, "")).toThrow(ScopedRepoError);
  });

  it("rejects a missing db handle", () => {
    expect(
      () => new FixtureRepo(undefined as unknown as DbOrTx, ORG_A),
    ).toThrow(ScopedRepoError);
  });

  it("exposes the bound org read-only via scopeOrgId", () => {
    expect(new FixtureRepo(fakeDb, ORG_A).scopeOrgId).toBe(ORG_A);
  });
});

describe("ScopedRepo — read predicate injection (FR3)", () => {
  it("injects `org_id = <bound org>` with the org as a bound parameter", () => {
    const repo = new FixtureRepo(fakeDb, ORG_A);
    const { sql, params } = renderWhere(repo.readPredicate());

    // The org must be a bound parameter, never interpolated into the SQL
    // text — that is both the injection-safety property and what lets the
    // predicate be the single tenant filter.
    expect(sql).toContain('"org_id" =');
    expect(params).toEqual([ORG_A]);
  });

  it("AND-s a repo-specific extra clause with the tenant predicate", () => {
    const repo = new FixtureRepo(fakeDb, ORG_A);
    const { sql, params } = renderWhere(
      repo.readPredicate(eq(auditEvents.eventType, "login_success")),
    );

    expect(sql).toContain('"org_id" =');
    expect(sql).toContain('"event_type" =');
    expect(sql).toContain(" and ");
    // Tenant org first, then the extra clause's value.
    expect(params).toEqual([ORG_A, "login_success"]);
  });
});

describe("ScopedRepo — write stamping (FR3 / AC-US2)", () => {
  // Inputs are typed consts, not inline literals, so TS applies normal
  // inference rather than excess-property checking against the generic
  // constraint — the same way a real repo passes its typed `input` object.
  it("stamps the bound org when the caller omits org_id", () => {
    const repo = new FixtureRepo(fakeDb, ORG_A);
    const values = { role: "owner" };
    expect(repo.stamp(values)).toEqual({ role: "owner", orgId: ORG_A });
  });

  it("accepts an explicit org_id that matches the bound org", () => {
    const repo = new FixtureRepo(fakeDb, ORG_A);
    const values = { orgId: ORG_A, role: "owner" };
    expect(repo.stamp(values)).toEqual({ orgId: ORG_A, role: "owner" });
  });

  it("overwrites a null org_id with the bound org", () => {
    const repo = new FixtureRepo(fakeDb, ORG_A);
    const values: { orgId: OrgId | null; role: string } = {
      orgId: null,
      role: "owner",
    };
    expect(repo.stamp(values)).toEqual({ orgId: ORG_A, role: "owner" });
  });

  it("refuses a write carrying a foreign org_id rather than silently re-stamping", () => {
    const repo = new FixtureRepo(fakeDb, ORG_A);
    const values = { orgId: ORG_B, role: "owner" };
    expect(() => repo.stamp(values)).toThrow(ScopedRepoError);
  });
});

describe("ScopedRepo — withTx preserves scope (NFR3)", () => {
  it("returns a same-org instance bound to the transaction", () => {
    const repo = new FixtureRepo(fakeDb, ORG_A);
    const txRepo = repo.withTx({} as Tx);
    expect(txRepo).not.toBe(repo);
    expect(txRepo.scopeOrgId).toBe(ORG_A);
  });
});

describe("tenantContext", () => {
  it("carries the local org", () => {
    expect(tenantContext(ORG_A)).toEqual({ localOrgId: ORG_A });
  });

  it("rejects an empty org (never defaulted — FR1)", () => {
    expect(() => tenantContext("")).toThrow(ScopedRepoError);
  });
});

describe("scopedRepo factory", () => {
  it("returns a bundle exposing withTx", () => {
    const repos = scopedRepo(ORG_A, fakeDb);
    expect(typeof repos.withTx).toBe("function");
  });

  it("withTx rebinds the whole bundle (same-org, tx-bound)", () => {
    const repos = scopedRepo(ORG_A, fakeDb);
    const txRepos = repos.withTx({} as Tx);
    expect(typeof txRepos.withTx).toBe("function");
  });

  it("rejects an empty org at the factory (runtime backstop)", () => {
    expect(() => scopedRepo("", fakeDb)).toThrow(ScopedRepoError);
  });

  it("rejects a missing db handle", () => {
    expect(() => scopedRepo(ORG_A, undefined as unknown as DbOrTx)).toThrow(
      ScopedRepoError,
    );
  });

  it("is a compile-time error to omit the orgId or db (AC-US2)", () => {
    // Enforced by tsc via the @ts-expect-error directives, not at runtime:
    // if either call ever type-checks, the unused-directive error fails
    // `bun run typecheck`. Wrapped in thunks so the throwing runtime guards
    // don't fire here — the point is the type error on the call expression.
    // @ts-expect-error orgId (and db) are required arguments
    const missingAll = () => scopedRepo();
    // @ts-expect-error db is a required argument
    const missingDb = () => scopedRepo(ORG_A);
    expect(typeof missingAll).toBe("function");
    expect(typeof missingDb).toBe("function");
  });
});
