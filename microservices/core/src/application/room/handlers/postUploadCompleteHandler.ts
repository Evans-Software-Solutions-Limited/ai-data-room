// POST /orgs/:orgId/uploads/:uploadId/complete — finalise a
// multipart upload (FR8-FR13). Flips the draft document `active`, or
// (FR13 filename collision) adds a new version to an existing active
// document.
//
// room-and-folders (slice 2) / T-011. Wraps `completeUpload` from
// the application layer. Authorization: cross-org guard +
// owner-or-editor role (mutation — default `authorizeOrgAccess`
// allowlist).

import Elysia, { t } from "elysia";

import { completeUpload } from "../upload";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { protectedDeps } from "../../auth/_shared/deps";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateUploadError } from "./uploadErrors";
import { roomDeps } from "./roomDeps";

export const postUploadCompleteHandler = new Elysia().post(
  "/orgs/:orgId/uploads/:uploadId/complete",
  async (ctx) => {
    const { params, body, headers, actor, scoped } = ctx as typeof ctx & {
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
      return await completeUpload(
        {
          uploadId: params.uploadId,
          documentId: body.documentId,
          versionId: body.versionId,
          parts: body.parts,
          actorUserId: actor.localUserId,
          audit,
        },
        {
          db: protectedDeps.db,
          documents: scoped.documents,
          documentVersions: scoped.documentVersions,
          store: roomDeps.store,
          auditRepo: protectedDeps.auditRepo,
        },
      );
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
      parts: t.Array(
        t.Object({
          partNumber: t.Integer({ minimum: 1 }),
          eTag: t.String({ minLength: 1 }),
        }),
        { minItems: 1 },
      ),
    }),
  },
);
