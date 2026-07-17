// DELETE /orgs/:orgId/uploads/:uploadId — abort a client-cancelled
// multipart upload, purging the draft document if it's still a
// draft.
//
// room-and-folders (slice 2) / T-011. Wraps `abortUpload` from the
// application layer. No audit (matches `abortUpload`'s deps — it
// takes no `auditRepo`). Authorization: cross-org guard +
// owner-or-editor role (mutation — default `authorizeOrgAccess`
// allowlist).
//
// Returns `200 {ok:true}` rather than a bodyless `204` — see
// `deleteDocumentHandler.ts`'s header for why a bare 204 is a
// runtime-dependent crash under Elysia 1.4's response mapper.

import Elysia, { t } from "elysia";

import { abortUpload } from "../upload";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateUploadError } from "./uploadErrors";
import { roomDeps } from "./roomDeps";

export const deleteUploadHandler = new Elysia().delete(
  "/orgs/:orgId/uploads/:uploadId",
  async (ctx) => {
    const { params, body, actor, scoped } = ctx as typeof ctx & {
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

    try {
      await abortUpload(
        {
          uploadId: params.uploadId,
          documentId: body.documentId,
          versionId: body.versionId,
          actorUserId: actor.localUserId,
        },
        {
          documents: scoped.documents,
          store: roomDeps.store,
        },
      );
      return { ok: true as const };
    } catch (err) {
      return translateUploadError(err);
    }
  },
  {
    params: t.Object({
      orgId: t.String({ format: "uuid" }),
      uploadId: t.String(),
    }),
    body: t.Object({
      documentId: t.String({ format: "uuid" }),
      versionId: t.String({ format: "uuid" }),
    }),
  },
);
