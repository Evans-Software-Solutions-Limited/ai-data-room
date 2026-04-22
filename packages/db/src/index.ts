// Public entry point for @ai-data-room/db.
//
// Callers (microservices/core handlers, worker entry points) should use
// `getDb()` to obtain a typed Drizzle client. The connection string
// comes from the SST resource `Resource.DatabaseUrl` — see
// infra/secrets.ts.

import { drizzle } from "drizzle-orm/postgres-js";
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
