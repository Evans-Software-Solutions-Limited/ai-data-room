// Zod schemas for the org-provisioning slice (slice 17).
//
// Single source of truth for the create-org request DTO and the
// `org.created` domain-event payload, shared between
// `microservices/core` (the `createOrg` application function +
// `POST /orgs` handler, T-002/T-003) and any consumer that needs the
// event shape (`room-and-folders` provisions the canonical room off
// `org.created`, T-005).
//
// Kept separate from `auth-orgs.ts` (the slice-1 aggregates) because
// these are slice-17-owned request/event contracts, not slice-1 domain
// rows — mirrors the T-004 note in `auth-orgs.ts` that HTTP/request
// schemas live with the slice that introduces them.
//
// References:
// - `.kiro/specs/ai-data-room/org-provisioning/{requirements,design}.md`
//   (FR1–FR6, the `org.created` payload `{ orgId, workosOrgId,
//   ownerUserId }`).

import { z } from "zod";

/**
 * Create-org request DTO (FR1). The caller supplies only a name; the
 * org id (local UUID), WorkOS org id, slug, and owner membership are
 * all derived server-side in `createOrg` (T-002).
 *
 * `name` is trimmed before length validation so leading/trailing
 * whitespace can't smuggle a value past the 1–80 bound or produce an
 * all-whitespace "name".
 */
export const CreateOrgInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export type CreateOrgInput = z.infer<typeof CreateOrgInputSchema>;

/**
 * EventBridge detail-type for the org-created domain event (FR3). The
 * dotted form is the AWS event-name convention and is deliberately
 * distinct from the audit `event_type` (`org_created`, snake_case to
 * match the slice-1 audit vocabulary in `AuditEventTypeSchema`). T-002
 * emits this on commit; `room-and-folders` subscribes to provision the
 * canonical room idempotently.
 */
export const ORG_CREATED_DETAIL_TYPE = "org.created" as const;

/**
 * `org.created` event payload (design.md §Data model). All ids are the
 * local mirror values except `workosOrgId`, which is the WorkOS-side
 * text id (sticky #16) — the room-provisioning subscriber keys its
 * idempotency on `orgId`.
 */
export const OrgCreatedEventSchema = z.object({
  orgId: z.string().uuid(),
  workosOrgId: z.string().min(1),
  ownerUserId: z.string().uuid(),
});

export type OrgCreatedEvent = z.infer<typeof OrgCreatedEventSchema>;
