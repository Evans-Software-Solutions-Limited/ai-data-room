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

// A TypeBox literal union built from a readonly string TUPLE, keeping the
// Elysia schema in lockstep with `MimeTypeEnum` (FR9) without re-declaring
// the list.
//
// Why not a bare `t.Union(values.map(t.Literal))`: `.map()` produces a plain
// `TLiteral[]` (array, not tuple). The server-side `Static` is fine, but
// `@elysiajs/eden`'s treaty client infers the corresponding body field as
// `never` on the web side (forcing every caller to cast). The runtime here
// is still exactly that `.map()` — a union of literals, no `default`, so a
// missing field still 422s (unlike `t.UnionEnum`, which injects a default
// and lets a missing value coerce through). What repairs the type is the
// annotated return type `LiteralUnionOf<T>`: it maps element-wise over the
// `const` tuple `T` to carry the per-member literals back OUT of this
// generic body (inside which `T` is opaque and destructuring would widen to
// `string`). eden then infers the real `"application/pdf" | …` union.
type LiteralUnionOf<T extends readonly string[]> = ReturnType<
  typeof t.Union<{
    -readonly [K in keyof T]: ReturnType<typeof t.Literal<T[K] & string>>;
  }>
>;

function literalUnion<const T extends readonly [string, ...string[]]>(
  values: T,
): LiteralUnionOf<T> {
  // Runtime is a plain union-of-literals; the annotated return type (mapped
  // element-wise over the `const` tuple `T`) is what carries the per-member
  // literals out of this generic body, where `T` is otherwise opaque.
  return t.Union(values.map((value) => t.Literal(value))) as LiteralUnionOf<T>;
}

const mimeTypeSchema = literalUnion(MimeTypeEnum.options);

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
