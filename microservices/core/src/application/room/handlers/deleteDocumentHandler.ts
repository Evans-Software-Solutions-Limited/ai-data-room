// DELETE /orgs/:orgId/documents/:id — soft-delete a document (FR17),
// starting its 30-day retention clock.
//
// room-and-folders (slice 2) / T-011. Wraps `softDeleteDocument`
// from the application layer. Authorization: cross-org guard +
// owner-or-editor role (mutation — default `authorizeOrgAccess`
// allowlist).
//
// Returns `200 {ok:true}` rather than a bodyless `204` — Elysia's
// `case void 0` branch in its response mapper constructs
// `new Response("", set)` for an `undefined`/no-body return, and the
// Fetch spec's "null body status" check (204/205/304) throws a
// TypeError for ANY non-null body, including an empty string, under
// spec-strict `Response` implementations (Node's `undici`). A small,
// explicit JSON body sidesteps the whole class of runtime-dependent
// crash.

import Elysia, { t } from "elysia";

import { softDeleteDocument } from "../deletion";
import type { ScopedRepos } from "../../../infrastructure/db/scoped";
import { protectedDeps } from "../../auth/_shared/deps";
import {
  authorizeOrgAccess,
  isAuthFailure,
} from "../../auth/_shared/orgAccess";
import { buildAuditContext } from "../../auth/_shared/auditContext";
import type { ProtectedAuthContext } from "../../auth/guards/authContextTypes";
import { translateDeletionError } from "./deletionErrors";

export const deleteDocumentHandler = new Elysia().delete(
  "/orgs/:orgId/documents/:id",
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
      await softDeleteDocument(
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
