// Room-and-folders route bundle — room-and-folders (slice 2) / T-011.
//
// Mirrors `application/auth/protectedRoutes.ts`'s `orgScopedRoutes`
// guard chain exactly (`requireAuth` → `resolveActorPlugin` →
// `requireOrg` → `resolveTenantContext` → `createScopedReposGuard`),
// PLUS one extra guard: `accessControlNoop`, mounted immediately
// after the scoped-repos guard so it runs with `ctx.scoped` already
// available. It's a no-op today (see its own header) — the seam
// slice 3 (access-control) fills in with the real per-route grant
// check.
//
// `roomRoutes` is composed INTO `protectedRoutes` (see
// `protectedRoutes.ts`) rather than mounted separately in `api.ts` —
// that way the existing `__tests__/protectedRoutes.test.ts` harness
// (mocks + `vi.doMock`/`vi.resetModules` dance) covers the room
// routes for free instead of needing its own parallel test file.

import Elysia from "elysia";

import { requireAuth } from "../../auth/guards/requireAuth";
import { requireOrg } from "../../auth/guards/requireOrg";
import { createScopedReposGuard } from "../../auth/guards/resolveScopedRepos";
import { resolveTenantContext } from "../../auth/guards/resolveTenantContext";
import { protectedDeps } from "../../auth/_shared/deps";
import { resolveActorPlugin } from "../../auth/_shared/resolveActorPlugin";

import { accessControlNoop } from "./accessControlNoop";
import { deleteDocumentHandler } from "./deleteDocumentHandler";
import { deleteUploadHandler } from "./deleteUploadHandler";
import { getCanonicalFolderHandler } from "./getCanonicalFolderHandler";
import { getDocumentHandler } from "./getDocumentHandler";
import { getDocumentVersionsHandler } from "./getDocumentVersionsHandler";
import { getOpportunitiesHandler } from "./getOpportunitiesHandler";
import { getOpportunityDocumentsHandler } from "./getOpportunityDocumentsHandler";
import { getRoomHandler } from "./getRoomHandler";
import { patchOpportunityHandler } from "./patchOpportunityHandler";
import { postArchiveOpportunityHandler } from "./postArchiveOpportunityHandler";
import { postOpportunityHandler } from "./postOpportunityHandler";
import { postRestoreDocumentHandler } from "./postRestoreDocumentHandler";
import { postUploadCompleteHandler } from "./postUploadCompleteHandler";
import { postUploadInitiateHandler } from "./postUploadInitiateHandler";

const roomScopedRoutes = new Elysia()
  .resolve(requireAuth)
  .resolve(resolveActorPlugin)
  .onBeforeHandle(requireOrg)
  .resolve(resolveTenantContext)
  .resolve(createScopedReposGuard(protectedDeps.db))
  // T-011 extension point (no-op until slice 3 / access-control ships).
  .onBeforeHandle(accessControlNoop)
  .use(getRoomHandler)
  .use(getCanonicalFolderHandler)
  .use(postOpportunityHandler)
  .use(getOpportunitiesHandler)
  .use(getOpportunityDocumentsHandler)
  .use(patchOpportunityHandler)
  .use(postArchiveOpportunityHandler)
  .use(getDocumentHandler)
  .use(getDocumentVersionsHandler)
  .use(deleteDocumentHandler)
  .use(postRestoreDocumentHandler)
  .use(postUploadInitiateHandler)
  .use(postUploadCompleteHandler)
  .use(deleteUploadHandler);

export const roomRoutes = new Elysia().use(roomScopedRoutes);
