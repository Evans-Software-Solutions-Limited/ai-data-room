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

import { readFileSync } from "node:fs";
import path from "node:path";

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

/**
 * Execute a committed migration `.sql` file statement-by-statement
 * against the given connection (the pool or a transaction handle).
 * Strips line comments and drizzle's `--> statement-breakpoint`
 * markers, then splits on `;` — postgres-js refuses multiple commands
 * in one `unsafe()` call, so each statement is sent individually.
 */
async function runMigrationFile(
  conn: { unsafe: (q: string) => Promise<unknown> },
  filename: string,
): Promise<void> {
  const raw = readFileSync(path.join(MIGRATIONS_FOLDER, filename), "utf8");
  const statements = raw
    .split("\n")
    .map((line) => line.replace(/--.*$/, "")) // drops `-- …` and `--> statement-breakpoint`
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await conn.unsafe(stmt);
  }
}

const EXPECTED_TABLES = [
  "audit_events",
  "external_access_grants",
  "invitations",
  "org_memberships",
  "organizations",
  "users",
  "webhook_deliveries",
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
    // No need to filter `__drizzle_migrations` — it lives in the
    // separate `drizzle` schema (drizzle-orm 0.30+), so the
    // `table_schema = 'public'` clause already excludes it.
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
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

  it("rolls back cleanly when public + drizzle schemas are dropped", async () => {
    const sql = getTestPool();

    // Drop both schemas (catastrophic-rollback floor) and re-apply.
    // Why both:
    //   - `public` holds the domain tables (organizations, users, …).
    //   - `drizzle` holds drizzle's own `__drizzle_migrations`
    //     bookkeeping table. Drizzle moved it out of `public` into
    //     its own schema in drizzle-orm 0.30+. If we only drop
    //     `public`, the bookkeeping survives, the migrator sees
    //     `0000_init_auth_and_orgs` already recorded as applied,
    //     and skips it — leaving `public` empty.
    //
    // Dropping both proves migrations re-apply cleanly from zero,
    // which is the actual rollback contract we care about.
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
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
      ORDER BY table_name
    `;
    expect(rowsAfterReapply.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);
  });

  // ── Slice 17 / T-000 — role-vocabulary migration (ADR-012) ──────────
  //
  // The enum *names* (`org_role`, `invitation_role`) are unchanged by the
  // rename, so the name-level check above can't see it. These assert the
  // enum *labels* (`pg_enum.enumlabel`) actually moved to the design's
  // `owner|editor|viewer` vocabulary and that `admin`/`internal` are gone.

  it("renames the role enum labels to the design vocabulary (T-000)", async () => {
    const sql = getTestPool();
    const labels = await sql<{ typname: string; enumlabel: string }[]>`
      SELECT t.typname, e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname IN ('org_role', 'invitation_role')
      ORDER BY t.typname, e.enumsortorder
    `;
    const labelsOf = (typname: string) =>
      labels.filter((r) => r.typname === typname).map((r) => r.enumlabel);

    expect(labelsOf("org_role")).toEqual(["owner", "editor", "viewer"]);
    expect(labelsOf("invitation_role")).toEqual(["editor", "viewer"]);

    const all = labels.map((r) => r.enumlabel);
    expect(all).not.toContain("admin");
    expect(all).not.toContain("internal");
  });

  it("up + down round-trips and preserves data — a former 'admin' row reads 'editor'", async () => {
    const sql = getTestPool();
    // Reverse to the shipped slice-1 vocabulary, seed rows under the OLD
    // labels, then re-apply the committed forward migration — all inside
    // one transaction so it's hermetic and net-zero on the global enum.
    // The ON COMMIT DROP temp table avoids organizations/users FK setup.
    const result = await sql.begin(async (tx) => {
      await runMigrationFile(tx, "0004_role_vocab_rename.down.sql");
      await tx.unsafe(
        "CREATE TEMP TABLE _role_probe (r org_role) ON COMMIT DROP",
      );
      await tx.unsafe(
        "INSERT INTO _role_probe (r) VALUES ('owner'), ('admin'), ('internal')",
      );
      await runMigrationFile(tx, "0004_role_vocab_rename.sql");
      const rows = await tx<{ r: string }[]>`
        SELECT r::text AS r FROM _role_probe ORDER BY r::text
      `;
      return rows.map((x) => x.r);
    });

    // RENAME VALUE relabels in place: the row stored while the label was
    // 'admin' now reads 'editor', 'internal' reads 'viewer', and 'owner'
    // is untouched. This is the data-preservation guarantee the generated
    // drop/recreate would have violated on a populated table.
    expect(result).toEqual(["editor", "owner", "viewer"]);
  });
});
