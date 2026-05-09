// GET /orgs/:orgId/audit-events — paginated audit-event listing.
//
// Slice 1 / T-014b. Thin pass-through to `AuditRepo.listByOrg` —
// no application-layer wrapper because the read is invariant-free
// (no business rules to enforce, no state transitions, no
// audit-of-the-audit emission). When slice 7's admin dashboard
// lands, this will likely move into a richer BFF aggregate; for
// v0.1 the minimal shape is sufficient.
//
// Authorization: cross-org guard + owner-or-admin role. Audit logs
// can leak business activity (which user signed in, who was
// invited where, etc.) so role-gating is non-negotiable.
//
// Pagination: keyset cursor `(occurredAt, id) < (cursor)` —
// `before` query param accepts an ISO timestamp + UUID pair. The
// id tiebreaker is load-bearing per sticky #12 (two events sharing
// a millisecond would otherwise be silently dropped between pages).

import Elysia, { status, t } from "elysia";

import { protectedDeps } from "../_shared/deps";
import { authorizeOrgAccess, isAuthFailure } from "../_shared/orgAccess";
import type { ProtectedAuthContext } from "../guards/authContextTypes";

export const getAuditEventsHandler = new Elysia().get(
  "/orgs/:orgId/audit-events",
  async (ctx) => {
    const { params, query, actor } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
    };

    const auth = await authorizeOrgAccess(
      { actor, paramOrgId: params.orgId },
      { membershipRepo: protectedDeps.membershipRepo },
    );
    if (isAuthFailure(auth)) {
      return auth;
    }

    // Partial cursors would silently degrade to "no cursor" and a
    // client paginating with a typo would loop forever — reject loud.
    if (
      (query.beforeOccurredAt && !query.beforeId) ||
      (!query.beforeOccurredAt && query.beforeId)
    ) {
      return status(400, {
        ok: false as const,
        reason: "incomplete_cursor" as const,
      });
    }

    let before: { occurredAt: Date; id: string } | undefined;
    if (query.beforeOccurredAt && query.beforeId) {
      const occurredAt = new Date(query.beforeOccurredAt);
      // `new Date("not-a-date")` is an `Invalid Date` whose getTime
      // returns NaN. Without this guard, the bad value would flow
      // into Drizzle's `lt(occurredAt, before.occurredAt)` and crash
      // at the SQL layer with a 500 — wrong code for "your input
      // was malformed", and a much worse triage signal than 400.
      if (Number.isNaN(occurredAt.getTime())) {
        return status(400, {
          ok: false as const,
          reason: "invalid_cursor_timestamp" as const,
        });
      }
      before = { occurredAt, id: query.beforeId };
    }

    return protectedDeps.auditRepo.listByOrg(params.orgId, {
      limit: query.limit,
      before,
    });
  },
  {
    params: t.Object({ orgId: t.String({ format: "uuid" }) }),
    query: t.Object({
      limit: t.Optional(t.Number({ minimum: 1, maximum: 200 })),
      beforeOccurredAt: t.Optional(t.String()),
      beforeId: t.Optional(t.String({ format: "uuid" })),
    }),
  },
);
