import { defineConfig } from "drizzle-kit";

// Connection string is read from DATABASE_URL at migrate / introspect time.
// Produced via SST secret `DatabaseUrl` per infra/secrets.ts — for local
// dev, export DATABASE_URL directly from a .env.local.

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
