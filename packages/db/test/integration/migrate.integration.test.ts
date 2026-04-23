// T-003 smoke test — proves the drizzle migration pipeline works
// end-to-end against a real Postgres.
//
// What this defends:
// 1. The committed `migrations/*.sql` files apply cleanly against the
//    integration database (Postgres 16, the same major version
//    PlanetScale runs).
// 2. Every table defined in `src/schema/auth.ts` exists after apply,
//    and the enum types are present.
// 3. A clean rollback (drop the public schema) and re-apply leaves the
//    database in its starting state — proving migrations are
//    reversible at the catastrophic-rollback level. Per-migration
//    reverse scripts land in T-005; this test only proves the floor.
//
// Pattern mirrors funds-distribution-platform's
// `microservices/core/test/integration/*.integration.test.ts`:
// shared pool from `setup.ts`, `applyMigrations` in beforeAll,
// `truncateAllTables` in beforeEach (no-op for this file since the
// smoke test doesn't insert data, but kept for symmetry with T-005's
// repo tests that will populate rows).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  applyMigrations,
  destroyTestPool,
  getTestPool,
  MIGRATIONS_FOLDER,
  truncateAllTables,
} from "./setup";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const EXPECTED_TABLES = [
  "audit_events",
  "external_access_grants",
  "invitations",
  "org_memberships",
  "organizations",
  "users",
];

const EXPECTED_ENUMS = [
  "audit_outcome",
  "external_grant_status",
  "invitation_kind",
  "invitation_role",
  "invitation_state",
  "org_role",
  "org_status",
  "user_lifecycle_state",
];

describe("drizzle migrations smoke test", () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await destroyTestPool();
  });

  it("applies the committed migrations cleanly", async () => {
    // Re-apply via the helper and assert it doesn't throw. Drizzle's
    // migrator is idempotent, so this proves both the apply path and
    // the "already-applied" no-op path.
    await expect(applyMigrations()).resolves.not.toThrow();
  });

  it("creates every table defined in src/schema/auth.ts", async () => {
    const sql = getTestPool();
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> '__drizzle_migrations'
      ORDER BY table_name
    `;
    expect(rows.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
  });

  it("creates every Postgres enum the schema declares", async () => {
    const sql = getTestPool();
    const rows = await sql<{ typname: string }[]>`
      SELECT typname
      FROM pg_type
      WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
      ORDER BY typname
    `;
    expect(rows.map((r) => r.typname)).toEqual(EXPECTED_ENUMS);
  });

  it("rolls back cleanly when the public schema is dropped + recreated", async () => {
    const sql = getTestPool();

    // Drop the schema (catastrophic-rollback floor) and re-apply.
    // Proves nothing in the migration depends on side state outside
    // the public schema.
    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");

    const tablesAfterDrop = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    expect(tablesAfterDrop[0]?.count).toBe("0");

    // Re-apply directly via drizzle's migrator — `applyMigrations`
    // would also work, but this asserts the public path explicitly.
    const db = drizzle(sql);
    await expect(
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    ).resolves.not.toThrow();

    const rowsAfterReapply = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> '__drizzle_migrations'
      ORDER BY table_name
    `;
    expect(rowsAfterReapply.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
  });
});
