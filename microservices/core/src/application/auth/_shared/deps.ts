// Module-scope deps for the protected-routes bundle.
//
// Slice 1 / T-015 + T-014b. Every protected handler shares the same
// six repos plus the WorkOS client and the Drizzle handle. SST
// surfaces `Resource.*` before Lambda init, so module-load is a safe
// place to construct — and matches FDP's convention. Without this,
// every request inside a warm Lambda re-allocates seven objects
// (and re-reads `Resource.PLANETSCALE_DATABASE_URL.value`) before
// the handler does any real work.
//
// Tests use the existing `vi.doMock(...) + vi.resetModules() +
// dynamic import` pattern (see `__tests__/protectedRoutes.test.ts`).
// `vi.resetModules` clears this module's cache so the next dynamic
// import reconstructs `protectedDeps` from the freshly-mocked
// `sst` / `@workos-inc/node` / `@ai-data-room/db` modules.

import { Resource } from "sst";

import { getDb } from "@ai-data-room/db";

import { AuditRepo } from "../../../infrastructure/db/auditRepo";
import { ExternalGrantRepo } from "../../../infrastructure/db/externalGrantRepo";
import { InvitationRepo } from "../../../infrastructure/db/invitationRepo";
import { MembershipRepo } from "../../../infrastructure/db/membershipRepo";
import { OrgRepo } from "../../../infrastructure/db/orgRepo";
import { UserRepo } from "../../../infrastructure/db/userRepo";

import { workos } from "./workosClient";

const db = getDb(Resource.PLANETSCALE_DATABASE_URL.value);

export const protectedDeps = {
  db,
  workos,
  userRepo: new UserRepo(db),
  orgRepo: new OrgRepo(db),
  membershipRepo: new MembershipRepo(db),
  invitationRepo: new InvitationRepo(db),
  externalGrantRepo: new ExternalGrantRepo(db),
  auditRepo: new AuditRepo(db),
};

export type ProtectedDeps = typeof protectedDeps;
