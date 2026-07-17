// GET /orgs/:orgId/documents/:id/versions — version history (FR15).
//
// room-and-folders (slice 2) / T-011. Wraps `listVersions` from the
// application layer. Read-only — no audit emission (matches
// `listVersions`'s own doc comment). Viewers may read
// (`ROOM_READ_ROLES`).

import Elysia, { t } from "elysia";

import { listVersions } from "../download";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateDownloadError } from "./downloadErrors";
import { ROOM_READ_ROLES } from "./roomDeps";

export const getDocumentVersionsHandler = new Elysia().get(
  "/orgs/:orgId/documents/:id/versions",
  async (ctx) => {
    const { params, actor, scoped } = ctx as typeof ctx & {
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

    try {
      return await listVersions(
        { documentId: params.id },
        {
          documents: scoped.documents,
          documentVersions: scoped.documentVersions,
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
  },
);
