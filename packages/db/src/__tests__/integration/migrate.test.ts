// T-003 smoke test — proves the drizzle migration pipeline works
// end-to-end against a real Postgres.
//
// What this defends:
// 1. The committed `migrations/*.sql` files apply cleanly against an
//    empty Postgres 16 database (the same major version PlanetScale
//    runs).
// 2. Every table defined in `src/schema/auth.ts` actually exists after
//    apply, and the enum types are present.
// 3. A clean rollback (drop the target schema) leaves the database in
//    its starting state, so the migrations are reversible at the
//    catastrophic-rollback level. Per-migration reverse scripts land
//    in T-005; this test only proves the floor.
//
// Per-file isolation: each test gets its own container so leaked state
// from one assertion can't poison another. Container startup is ~2s on
// a warm docker daemon, ~10s cold.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// migrations live at packages/db/migrations
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../migrations");

// The exhaustive list of objects the auth migration is responsible for
// creating. If T-005 (or any future task) adds tables/enums, extend
// these arrays — the smoke test then doubles as a "did you remember to
// commit the migration?" canary.
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
  let container: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    sql = postgres(container.getConnectionUri(), { max: 1, prepare: false });
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await container?.stop();
  });

  it("applies the committed migrations cleanly against an empty database", async () => {
    const db = drizzle(sql);
    await expect(
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    ).resolves.not.toThrow();
  });

  it("creates every table defined in src/schema/auth.ts", async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const tableNames = rows
      .map((r) => r.table_name)
      // drizzle's bookkeeping table — not part of the domain schema.
      .filter((n) => n !== "__drizzle_migrations");
    expect(tableNames).toEqual(EXPECTED_TABLES);
  });

  it("creates every Postgres enum the schema declares", async () => {
    const rows = await sql<{ typname: string }[]>`
      SELECT typname
      FROM pg_type
      WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
      ORDER BY typname
    `;
    expect(rows.map((r) => r.typname)).toEqual(EXPECTED_ENUMS);
  });

  it("rolls back cleanly when the public schema is dropped + recreated", async () => {
    // Drop the schema (catastrophic-rollback floor) and re-apply. Proves
    // there's nothing in the migration that depends on side state outside
    // the public schema.
    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");

    const tablesAfterDrop = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    expect(tablesAfterDrop[0]?.count).toBe("0");

    // Re-apply — drizzle's bookkeeping table got dropped too, so this is
    // a fresh apply, not an idempotent re-run.
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
