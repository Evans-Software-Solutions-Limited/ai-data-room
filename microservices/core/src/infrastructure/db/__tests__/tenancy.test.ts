// Tenant-isolation (slice 10) / T-001 — registry classification invariant.
//
// The load-bearing assertion: EVERY Drizzle table in the schema is classified
// into EXACTLY ONE of the three tenancy buckets, and no registry entry names a
// table that doesn't exist. This is what makes the registry trustworthy — when
// a later slice adds a table to the schema without classifying it (or fat-
// fingers a name), this test fails CI rather than letting an unscoped table
// slip silently past the factory + tripwire.

import { describe, expect, it } from "vitest";
import { getTableName, is, Table } from "drizzle-orm";

import { schema } from "@ai-data-room/db";

import {
  ALL_CLASSIFIED_TABLES,
  IDENTITY_TABLES,
  isTenantScoped,
  TENANT_AGNOSTIC_TABLES,
  TENANT_SCOPED_TABLES,
} from "../tenancy";

/** Every SQL table name Drizzle knows about, from the schema barrel. The
 *  barrel also exports pgEnums + relations, so filter to Table instances.
 *  Cast to `unknown[]` first: the schema union includes `PgEnum`, and a
 *  `v is Table` predicate is only valid when `Table` is assignable to the
 *  parameter type (it is to `unknown`, not to the mixed union). */
const schemaTableNames = (Object.values(schema) as unknown[])
  .filter((v): v is Table => is(v, Table))
  .map((t) => getTableName(t))
  .sort();

describe("tenancy registry", () => {
  it("classifies every Drizzle table exactly once (bijection with the schema)", () => {
    const classified = [...ALL_CLASSIFIED_TABLES].sort();

    // No table left unclassified, and no registry entry for a table that
    // doesn't exist — the two failure modes that would make the registry lie.
    expect(classified).toEqual(schemaTableNames);
  });

  it("has no duplicate entries within or across the three buckets", () => {
    const all = [...ALL_CLASSIFIED_TABLES];
    expect(new Set(all).size).toBe(all.length);

    // Pairwise-disjoint buckets.
    const scoped = new Set<string>(TENANT_SCOPED_TABLES);
    const agnostic = new Set<string>(TENANT_AGNOSTIC_TABLES);
    const identity = new Set<string>(IDENTITY_TABLES);
    for (const t of agnostic) expect(scoped.has(t)).toBe(false);
    for (const t of identity) {
      expect(scoped.has(t)).toBe(false);
      expect(agnostic.has(t)).toBe(false);
    }
  });

  it("classifies the slice-1 tables per the design decision", () => {
    // Carry org_id → scoped.
    expect(TENANT_SCOPED_TABLES).toContain("org_memberships");
    expect(TENANT_SCOPED_TABLES).toContain("invitations");
    expect(TENANT_SCOPED_TABLES).toContain("external_access_grants");
    expect(TENANT_SCOPED_TABLES).toContain("audit_events");

    // The org IS the tenant / global infra → agnostic.
    expect(TENANT_AGNOSTIC_TABLES).toContain("organizations");
    expect(TENANT_AGNOSTIC_TABLES).toContain("webhook_deliveries");

    // No org_id; tenancy is the membership edge → identity (NOT scoped).
    // This is the gap the spec review caught: `users` must not be scoped,
    // because userRepo runs before tenant context exists (resolveActor).
    expect(IDENTITY_TABLES).toContain("users");
    expect(isTenantScoped("users")).toBe(false);
  });

  it("isTenantScoped is true only for the scoped bucket", () => {
    for (const t of TENANT_SCOPED_TABLES) expect(isTenantScoped(t)).toBe(true);
    for (const t of TENANT_AGNOSTIC_TABLES)
      expect(isTenantScoped(t)).toBe(false);
    for (const t of IDENTITY_TABLES) expect(isTenantScoped(t)).toBe(false);
    expect(isTenantScoped("nonexistent_table")).toBe(false);
  });
});
