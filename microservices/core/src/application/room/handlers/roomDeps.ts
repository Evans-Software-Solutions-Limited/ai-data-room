// Module-scope deps for the room-and-folders handler bundle —
// room-and-folders (slice 2) / T-011.
//
// Mirrors `application/auth/_shared/deps.ts`'s warm-Lambda pattern:
// constructed once at module load (safe — SST surfaces `Resource.*`
// before Lambda init), reused across every request in a warm Lambda
// rather than re-allocated per-request.
//
// **The S3 bucket is AWS-deferred to T-001.** `infra/api.ts` doesn't
// yet declare a `DocsBucket` resource (T-001 is blocked on expired
// AWS creds — see `project_room_and_folders_progress` memory), so
// this file CANNOT read `Resource.DocsBucket.name` without breaking
// `bun run typecheck` for every workspace today. Instead the bucket
// name (and optional KMS key id) come from plain env vars that T-001
// will wire into the Lambda's environment once the bucket exists;
// until then `DOCS_BUCKET` is unset and every S3 call this store
// makes will fail at runtime (not at typecheck/build time) — expected
// for a deferred slice, and no route under test in
// `__tests__/protectedRoutes.test.ts` exercises the real client (the
// suite mocks `createS3DocumentStore` instead).
//
// Do NOT touch `infra/api.ts` here — the bucket resource doesn't
// exist yet (T-001 owns declaring + linking it).

import { S3Client } from "@aws-sdk/client-s3";
import type { Role } from "@ai-data-room/api-utils/schemas/auth-orgs";

import { createS3DocumentStore } from "../../../infrastructure/s3/client";

export const roomDeps = {
  store: createS3DocumentStore({
    client: new S3Client({}),
    bucket: process.env.DOCS_BUCKET ?? "",
    kmsKeyId: process.env.DOCS_KMS_KEY_ID,
  }),
};

export type RoomDeps = typeof roomDeps;

/** Allowlist for the room slice's READ routes — unlike the
 *  `OWNER_EDITOR` default `authorizeOrgAccess` uses for mutations,
 *  viewers may read room contents (FR7/FR14/FR15 are read-only). */
export const ROOM_READ_ROLES: ReadonlyArray<Role> = [
  "owner",
  "editor",
  "viewer",
] as const;
