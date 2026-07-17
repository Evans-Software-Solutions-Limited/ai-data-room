// POST /orgs/:orgId/uploads/initiate — begin a resumable multipart
// upload into a canonical folder or an Opportunity subroom (FR8-FR11).
//
// room-and-folders (slice 2) / T-011. Wraps `initiateUpload` from the
// application layer. No audit on initiate (matches `upload.ts`'s
// header note — the audited event is `file_uploaded` at complete).
// Authorization: cross-org guard + owner-or-editor role (mutation —
// default `authorizeOrgAccess` allowlist).
//
// `target.folder` is typed as a bare `t.String()` at the Elysia
// schema layer (TypeBox can't express "one of the seven canonical
// folder literals" alongside the discriminated union as cleanly as a
// zod `.enum()` can) — this handler re-validates it against
// `CanonicalFolderSchema` before constructing the domain
// `UploadTarget`, same pattern as `getCanonicalFolderHandler`.

import Elysia, { status, t } from "elysia";
import {
  CanonicalFolderSchema,
  MAX_UPLOAD_BYTES,
  MimeTypeEnum,
  type UploadTarget,
} from "@ai-data-room/api-utils/schemas/rooms";

import { initiateUpload } from "../upload";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateUploadError } from "./uploadErrors";
import { roomDeps } from "./roomDeps";

const targetSchema = t.Union([
  t.Object({ kind: t.Literal("canonical"), folder: t.String() }),
  t.Object({
    kind: t.Literal("opportunity"),
    opportunityId: t.String({ format: "uuid" }),
  }),
]);

// `t.Literal` per MIME type keeps the Elysia schema in lockstep with
// `MimeTypeEnum` (FR9) without re-declaring the list.
const mimeTypeSchema = t.Union(
  MimeTypeEnum.options.map((value) => t.Literal(value)),
);

export const postUploadInitiateHandler = new Elysia().post(
  "/orgs/:orgId/uploads/initiate",
  async (ctx) => {
    const { params, body, actor, scoped, set } = ctx as typeof ctx & {
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

    let target: UploadTarget;
    if (body.target.kind === "canonical") {
      const parsedFolder = CanonicalFolderSchema.safeParse(body.target.folder);
      if (!parsedFolder.success) {
        return status(400, {
          ok: false as const,
          reason: "invalid_canonical_folder" as const,
        });
      }
      target = { kind: "canonical", folder: parsedFolder.data };
    } else {
      target = {
        kind: "opportunity",
        opportunityId: body.target.opportunityId,
      };
    }

    try {
      const result = await initiateUpload(
        {
          target,
          filename: body.filename,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
          actorUserId: actor.localUserId,
        },
        {
          documents: scoped.documents,
          opportunities: scoped.opportunities,
          store: roomDeps.store,
        },
      );
      set.status = 201;
      return result;
    } catch (err) {
      return translateUploadError(err);
    }
  },
  {
    params: t.Object({ orgId: t.String({ format: "uuid" }) }),
    body: t.Object({
      target: targetSchema,
      filename: t.String({ minLength: 1, maxLength: 255 }),
      mimeType: mimeTypeSchema,
      sizeBytes: t.Number({ minimum: 1, maximum: MAX_UPLOAD_BYTES }),
    }),
  },
);
