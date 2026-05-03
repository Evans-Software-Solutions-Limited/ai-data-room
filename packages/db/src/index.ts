// Public entry point for @ai-data-room/db.
//
// Callers (microservices/core handlers, worker entry points) should use
// `getDb()` to obtain a typed Drizzle client. The connection string
// comes from the SST resource `Resource.DatabaseUrl` — see
// infra/secrets.ts.

import { drizzle } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb(connectionString: string) {
  if (_db) return _db;
  const client = postgres(connectionString, {
    // Lambda-friendly pool: small and short-lived.
    max: 1,
    idle_timeout: 10,
    max_lifetime: 60 * 5,
    prepare: false,
  });
  _db = drizzle(client, { schema });
  return _db;
}

export { schema };
export type Db = ReturnType<typeof getDb>;

/**
 * The transaction handle Drizzle's `db.transaction(cb)` passes to its
 * callback. Repos accept `DbOrTx` so the same instance works whether
 * called directly on the pool or inside a transaction; `Repo#withTx`
 * is the factory that swaps in the tx-bound version.
 */
export type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Repos accept this union so the same instance works whether called
 * on the pool client (`Db`) or on a transaction handle (`Tx`); use
 * `Repo#withTx` to swap an existing repo onto a tx for the duration
 * of a `db.transaction()` callback.
 */
export type DbOrTx = Db | Tx;
