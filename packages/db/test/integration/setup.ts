// Shared test helpers for the integration suite. Mirrors FDP's pattern
// (microservices/core/test/integration/setup.ts):
//
//   beforeAll  → applyMigrations()      // once per test file
//   beforeEach → truncateAllTables()    // hermetic between cases
//   afterAll   → destroyTestPool()      // close the pool
//
// Connection resolution:
//   1. INTEGRATION_DATABASE_URL env var (CI uses the GitHub Actions
//      service container; live-DB jobs can point this at a real
//      PlanetScale dev branch).
//   2. Local fallback to the docker-compose container in this dir
//      (postgres:16-alpine on port 5433).
//
// This module is the single place tests touch when they need a
// connection. Keep it dependency-free of the application layer so
// repository tests can construct their own client wiring on top of the
// raw `postgres()` pool.

import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import * as testSchema from "../../src/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolves to packages/db/migrations regardless of where vitest is
// invoked from.
export const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../migrations");

const LOCAL_FALLBACK =
  "postgres://ai_data_room:ai_data_room@localhost:5433/ai_data_room_test";

export const TEST_CONNECTION_STRING =
  process.env.INTEGRATION_DATABASE_URL ?? LOCAL_FALLBACK;

let pool: ReturnType<typeof postgres> | null = null;

/**
 * Drizzle client bound to the test pool, with the project schema
 * attached. Three callsites (the existing per-repo `beforeAll` and
 * the new `withTx` integration tests) construct this the same way;
 * keeping the construction here means a future schema-config change
 * doesn't fan out across every test file.
 */
export function getTestDb(): ReturnType<typeof drizzle<typeof testSchema>> {
  return drizzle(getTestPool(), { schema: testSchema });
}

/**
 * Lazy singleton — one pool per test process. `max: 5` keeps the
 * footprint small without serialising all queries; matches FDP.
 */
export function getTestPool(): ReturnType<typeof postgres> {
  if (!pool) {
    pool = postgres(TEST_CONNECTION_STRING, {
      max: 5,
      // Lambda-style settings don't apply here (no cold-start churn);
      // we just want predictable test behaviour.
      prepare: false,
      // Drizzle's migrator runs `CREATE SCHEMA IF NOT EXISTS drizzle`
      // and `CREATE TABLE IF NOT EXISTS __drizzle_migrations` on every
      // call, which Postgres responds to with NOTICE messages that
      // postgres.js logs to stdout. Silence them to keep CI output
      // readable; if a test fails we still get the real error.
      onnotice: () => {
        /* swallowed — see comment above */
      },
    });
  }
  return pool;
}

/**
 * Apply every committed migration against the test DB. Idempotent —
 * Drizzle's migrator records applied migrations in its own
 * `drizzle.__drizzle_migrations` bookkeeping table (note: separate
 * `drizzle` schema as of drizzle-orm 0.30+) and skips ones it has
 * already run, so calling this in `beforeAll` of every test file is
 * safe and cheap.
 */
export async function applyMigrations(): Promise<void> {
  const sql = getTestPool();
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Wipe every table the migrations created, leaving the schema (and
 * Drizzle's bookkeeping in the separate `drizzle` schema) intact. Use
 * in `beforeEach` to keep cases hermetic without paying the cost of
 * dropping + re-applying the migration set.
 *
 * Discovery is by query against `information_schema` rather than a
 * hard-coded list — adding a table in T-005 (or any future slice) does
 * not require a touch here. The `table_schema = 'public'` clause
 * naturally excludes drizzle's `__drizzle_migrations` (which lives
 * under `drizzle.*` since drizzle-orm 0.30+).
 */
export async function truncateAllTables(): Promise<void> {
  const sql = getTestPool();
  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.table_name}"`).join(", ");
  // RESTART IDENTITY = reset sequences so generated IDs start fresh.
  // CASCADE = follow FK references so we don't have to truncate in
  // dependency order.
  await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Close the pool. Call from `afterAll` so vitest doesn't hang waiting
 * for an open socket.
 */
export async function destroyTestPool(): Promise<void> {
  if (pool) {
    await pool.end({ timeout: 5 });
    pool = null;
  }
}
