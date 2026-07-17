// GET /orgs/:orgId/documents/:id — fetch a document (its current or
// a specific past version) with a short-lived presigned download URL
// (FR14/FR16).
//
// room-and-folders (slice 2) / T-011. Wraps `getDocument` from the
// application layer. Read (from the caller's perspective) but
// `getDocument` audits every download (FR19). Viewers may read
// (`ROOM_READ_ROLES`).

import Elysia, { t } from "elysia";

import { getDocument } from "../download";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { protectedDeps } from "../../auth/_shared/deps";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateDownloadError } from "./downloadErrors";
import { roomDeps, ROOM_READ_ROLES } from "./roomDeps";

export const getDocumentHandler = new Elysia().get(
  "/orgs/:orgId/documents/:id",
  async (ctx) => {
    const { params, query, headers, actor, scoped } = ctx as typeof ctx & {
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

    const audit = buildAuditContext(headers);

    try {
      return await getDocument(
        {
          documentId: params.id,
          versionId: query.versionId,
          actorUserId: actor.localUserId,
          audit,
        },
        {
          documents: scoped.documents,
          documentVersions: scoped.documentVersions,
          opportunities: scoped.opportunities,
          store: roomDeps.store,
          auditRepo: protectedDeps.auditRepo,
        },
      );
    } catch (err) {
      return translateDownloadError(err);
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      id: t.String({ format: "uuid" }),
    }),
    query: t.Object({
      versionId: t.Optional(t.String({ format: "uuid" })),
    }),
  },
);
