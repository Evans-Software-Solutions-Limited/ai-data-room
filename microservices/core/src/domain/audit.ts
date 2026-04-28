// Domain barrel: audit aggregate.
//
// `AuditEventType` is the enum of the 21 event types from FR24 — the
// system of record for product-level audit. The exhaustiveness of
// the enum vs. the FR is asserted in the schemas test.
//
// Pure type re-exports — see `org.ts` for the rationale.

export type {
  AuditEvent,
  AuditEventType,
  AuditOutcome,
} from "@ai-data-room/api-utils/schemas/auth-orgs";
