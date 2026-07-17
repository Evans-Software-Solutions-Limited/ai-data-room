// POST /orgs/:orgId/documents/:id/restore — restore a soft-deleted
// document within its 30-day retention window (FR17).
//
// room-and-folders (slice 2) / T-011. Wraps `restoreDocument` from
// the application layer. Authorization: cross-org guard +
// owner-or-editor role (mutation — default `authorizeOrgAccess`
// allowlist).

import Elysia, { t } from "elysia";

import { restoreDocument } from "../deletion";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { protectedDeps } from "../../auth/_shared/deps";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateDeletionError } from "./deletionErrors";

export const postRestoreDocumentHandler = new Elysia().post(
  "/orgs/:orgId/documents/:id/restore",
  async (ctx) => {
    const { params, headers, actor, scoped } = ctx as typeof ctx & {
      actor: ProtectedAuthContext["actor"];
      scoped: ScopedRepos;
    };

    const auth = await authorizeOrgAccess(
      { actor, paramOrgId: params.orgId },
      { membership: scoped.membership },
    );
    if (isAuthFailure(auth)) {
      return auth;
    }

    const audit = buildAuditContext(headers);

    try {
      await restoreDocument(
        {
          documentId: params.id,
          actorUserId: actor.localUserId,
          audit,
        },
        {
          documents: scoped.documents,
          auditRepo: protectedDeps.auditRepo,
        },
      );
      return { ok: true as const };
    } catch (err) {
      return translateDeletionError(err);
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      id: t.String({ format: "uuid" }),
    }),
  },
);
