// POST /orgs/:orgId/invitations — issue an invitation per FR6 / FR7.
//
// Slice 1 / T-014b. Wraps `createInvitation` from the application
// layer. The handler owns:
//
//   - Cross-org guard + role check (only owner / admin) via
//     `authorizeOrgAccess` (sticky #22 / #30).
//   - Body validation via Elysia `t.Object` — internal vs. external
//     kinds are a discriminated union to keep `role` and
//     `opportunitySlug` mutually exclusive at the schema layer.
//   - Translating `InvitationError` reasons to status codes.
//
// The application function still enforces the only-owner-can-invite-
// admin rule because that's a domain-specific permission (role-vs-
// invited-role); the broader "owner / admin can invite at all"
// check is handler-level.

import Elysia, { status, t } from "elysia";
import { Resource } from "sst";

import { getDb } from "@ai-data-room/db";

import {
  createInvitation,
  InvitationError,
} from "../../../application/invitations";
import { AuditRepo } from "../../../infrastructure/db/auditRepo";
import { InvitationRepo } from "../../../infrastructure/db/invitationRepo";
import { MembershipRepo } from "../../../infrastructure/db/membershipRepo";
import { OrgRepo } from "../../../infrastructure/db/orgRepo";
import { UserRepo } from "../../../infrastructure/db/userRepo";
import { createWorkOSClient } from "../../../infrastructure/workos/client";
import { authorizeOrgAccess, isAuthFailure } from "../_shared/orgAccess";
import { buildAuditContext } from "../_shared/auditContext";
import type { ProtectedAuthContext } from "../guards/authContextTypes";

const internalBodySchema = t.Object({
  email: t.String({ format: "email", minLength: 3 }),
  kind: t.Literal("internal"),
  role: t.Union([t.Literal("admin"), t.Literal("internal")]),
});

const externalBodySchema = t.Object({
  email: t.String({ format: "email", minLength: 3 }),
  kind: t.Literal("external"),
  opportunitySlug: t.String({ minLength: 1, maxLength: 64 }),
});

export const postInvitationsHandler = new Elysia().post(
  "/orgs/:orgId/invitations",
  async (ctx) => {
    // Standalone Elysia plugins don't see the parent bundle's
    // `.resolve(resolveActor)` at type level — narrow inside the
    // body. Same pattern as FDP's `getUserHandler`.
    const { params, body, headers, actor, set } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
    };
    const db = getDb(Resource.PLANETSCALE_DATABASE_URL.value);
    const workos = createWorkOSClient({
      apiKey: Resource.WORKOS_API_KEY.value,
      clientId: Resource.WORKOS_CLIENT_ID.value,
    });
    const userRepo = new UserRepo(db);
    const orgRepo = new OrgRepo(db);
    const membershipRepo = new MembershipRepo(db);
    const invitationRepo = new InvitationRepo(db);
    const auditRepo = new AuditRepo(db);

    const auth = await authorizeOrgAccess(
      { actor, paramOrgId: params.orgId },
      { membershipRepo },
    );
    if (isAuthFailure(auth)) {
      return auth;
    }

    const audit = buildAuditContext(headers);

    try {
      const invitation = await createInvitation(
        body.kind === "internal"
          ? {
              email: body.email,
              orgId: params.orgId,
              actorId: actor.localUserId,
              actorRole: auth.role,
              audit,
              kind: "internal",
              role: body.role,
            }
          : {
              email: body.email,
              orgId: params.orgId,
              actorId: actor.localUserId,
              actorRole: auth.role,
              audit,
              kind: "external",
              opportunitySlug: body.opportunitySlug,
            },
        { workos, userRepo, orgRepo, invitationRepo, auditRepo },
      );
      set.status = 201;
      return invitation;
    } catch (err) {
      return translateInvitationError(err);
    }
  },
  {
    params: t.Object({ orgId: t.String({ format: "uuid" }) }),
    body: t.Union([internalBodySchema, externalBodySchema]),
  },
);

function translateInvitationError(err: unknown) {
  if (!(err instanceof InvitationError)) {
    throw err;
  }
  switch (err.reason) {
    case "actor_role_insufficient":
      // Defence in depth — `authorizeOrgAccess` should have caught
      // this already, but the application function re-validates and
      // we honour its 403.
      return status(403, { ok: false as const, reason: err.reason });
    case "only_owner_can_invite_admin":
      return status(403, { ok: false as const, reason: err.reason });
    case "inviter_user_not_found":
    case "org_not_found":
      // Both indicate handler-passed IDs that don't resolve in the
      // local DB — possible only if the actor's `users` row or the
      // org row was deleted between `requireAuth` and this call.
      // 500 surfaces the inconsistency rather than papering over it.
      return status(500, { ok: false as const, reason: err.reason });
    default:
      // Future reasons land here — re-throw rather than silently
      // returning a 500 with a non-existent reason string.
      throw err;
  }
}
