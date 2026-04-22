// Database wiring.
//
// Per ADR-002 we use PlanetScale Postgres (managed). The connection
// string is provisioned outside SST and surfaced through the
// `DatabaseUrl` secret in infra/secrets.ts. This module exists so
// sst.config.ts has a deterministic place to declare DB-adjacent AWS
// resources as they accumulate (RDS Proxy if we ever move to RDS, KMS
// keys for field-level encryption when SOC 2 lands, etc.).

// Placeholder export so sst.config.ts can `import("./infra/db")` without
// the import being tree-shaken into nothing.
export const _dbWiringMarker = "ai-data-room.db.v0";

// ── FUTURE ─────────────────────────────────────────────────────────────
// - RDS Proxy (if we ever move off PlanetScale): new sst.aws.RdsProxy(...)
// - Field-encryption KMS key (SOC 2 entry): new sst.aws.KmsKey("PiiKey")
// - Read replica connection string secret (scale phase)
