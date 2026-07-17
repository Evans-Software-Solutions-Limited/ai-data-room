// GET /orgs/:orgId/rooms/folders/:canonical — a canonical folder's
// contents (FR7).
//
// room-and-folders (slice 2) / T-011. Wraps `listFolderContents`
// from the application layer with `target.kind === "canonical"`.
// `:canonical` is validated against `CanonicalFolderSchema` in the
// handler (Elysia's `t.String()` can't express the const-enum
// membership check) — an unknown segment is a 400, not a 404 (the
// URL shape itself is malformed, distinct from `folder_not_found`
// which `listFolderContents` never actually throws for a canonical
// target). Read-only from the caller's perspective, but
// `listFolderContents` DOES audit every folder listing (FR19), so
// this still builds an `AuditContext`. Viewers may read
// (`ROOM_READ_ROLES`).

import Elysia, { status, t } from "elysia";
import { CanonicalFolderSchema } from "@ai-data-room/api-utils/schemas/rooms";

import { listFolderContents } from "../listing";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { protectedDeps } from "../../auth/_shared/deps";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateListingError } from "./listingErrors";
import { ROOM_READ_ROLES } from "./roomDeps";

export const getCanonicalFolderHandler = new Elysia().get(
  "/orgs/:orgId/rooms/folders/:canonical",
  async (ctx) => {
    const { params, headers, actor, scoped } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
      scoped: ScopedRepos;
    };

    const auth = await authorizeOrgAccess(
      { actor, paramOrgId: params.orgId },
      { membership: scoped.membership },
      ROOM_READ_ROLES,
    );
    if (isAuthFailure(auth)) {
      return auth;
    }

    const parsedFolder = CanonicalFolderSchema.safeParse(params.canonical);
    if (!parsedFolder.success) {
      return status(400, {
        ok: false as const,
        reason: "invalid_canonical_folder" as const,
      });
    }

    const audit = buildAuditContext(headers);

    try {
      return await listFolderContents(
        {
          target: { kind: "canonical", folder: parsedFolder.data },
          actorUserId: actor.localUserId,
          audit,
        },
        {
          documents: scoped.documents,
          opportunities: scoped.opportunities,
          auditRepo: protectedDeps.auditRepo,
        },
      );
    } catch (err) {
      return translateListingError(err);
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      canonical: t.String(),
    }),
  },
);
