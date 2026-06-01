// Application-layer create-org flow — slice 17 / org-provisioning T-002.
//
// An authenticated actor with no membership creates their organisation:
//
//   1. FR5 single-membership guard — reject if the actor already
//      belongs to an org.
//   2. Create the WorkOS organisation (external call, BEFORE the DB
//      transaction — see the ordering/compensation note below).
//   3. In one `withTx` transaction (sticky #15): mirror the WorkOS org
//      to a local `orgs` row (sticky #16) + create the creator's
//      `owner` membership.
//   4. Post-commit: `safeAudit` `org_created` + `membership_created`,
//      then emit `org.created` for `room-and-folders` to provision the
//      canonical room (FR3, via the injected `OrgEventPublisher` port —
//      the EventBridge transport lands in T-005).
//
// WorkOS-create-then-DB-tx ordering + compensation (the T-002 open
// question): the WorkOS org is created before the DB writes because the
// local `orgs` row needs the WorkOS id to mirror. If the DB transaction
// then fails, we COMPENSATE — best-effort delete the just-created WorkOS
// org — rather than leave an orphan. The delete is best-effort: if it
// also fails we log + meter for manual reconciliation, but the request
// still fails cleanly with no local rows (the transaction rolled back).
// Chosen over "accept a logged orphan" because an orphaned WorkOS org
// could later collide or be mistaken for a real tenant.

import type { Db } from "@ai-data-room/db";
import type {
  CreateOrgInput,
  OrgCreatedEvent,
} from "@ai-data-room/api-utils/schemas/org";
import type {
  Org,
  OrgMembership,
} from "@ai-data-room/api-utils/schemas/auth-orgs";
import { serializeError } from "@ai-data-room/api-utils/logging";

import type { AuditRepo } from "../../infrastructure/db/auditRepo";
import type { MembershipRepo } from "../../infrastructure/db/membershipRepo";
import type { OrgRepo } from "../../infrastructure/db/orgRepo";
import type { OrgEventPublisher } from "../../infrastructure/events/orgEventPublisher";
import type { WorkOSClient } from "../../infrastructure/workos/client";
import { logger } from "../../infrastructure/logging/logger";
import { emitCount } from "../../infrastructure/observability/metrics";
import { type AuditContext, safeAudit } from "../_audit-context";

export type CreateOrgErrorReason =
  /** FR5 — the actor already belongs to an org (single-membership at v0.1). */
  | "already_member"
  /** WorkOS org create failed, or the local transaction failed (and the
   *  WorkOS org was compensated). Either way no local org exists. */
  | "provisioning_failed";

export class CreateOrgError extends Error {
  public readonly reason: CreateOrgErrorReason;
  constructor(reason: CreateOrgErrorReason, options?: { cause?: unknown }) {
    super(reason, options);
    this.reason = reason;
    this.name = "CreateOrgError";
  }
}

export interface CreateOrgDeps {
  db: Db;
  workos: Pick<WorkOSClient, "createOrganization" | "deleteOrganization">;
  orgRepo: OrgRepo;
  membershipRepo: MembershipRepo;
  auditRepo: AuditRepo;
  events: OrgEventPublisher;
}

export interface CreateOrgParams {
  /** Local UUID of the authenticated creator (becomes the org owner). */
  actorUserId: string;
  input: CreateOrgInput;
  audit: AuditContext;
}

export interface CreateOrgResult {
  orgId: string;
  role: "owner";
  org: Org;
  membership: OrgMembership;
  event: OrgCreatedEvent;
}

const SLUG_MAX = 64;
// Leave headroom for a `-NN` / `-<8hex>` uniqueness suffix.
const SLUG_BASE_MAX = SLUG_MAX - 10;
const MAX_SLUG_ATTEMPTS = 50;
// Bounded retries of the whole create transaction on a concurrent slug
// unique-index collision (two different users whose names normalise to
// the same slug). The suffix loop only de-dupes against *committed*
// rows; the loser of a same-instant race re-derives a free slug on
// retry rather than failing with a 500.
const MAX_CREATE_ATTEMPTS = 3;
const SLUG_UNIQUE_CONSTRAINT = "organizations_slug_key";

/** True for the Postgres unique-violation (23505) on the org slug index. */
function isSlugConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    code?: string;
    constraint_name?: string;
    message?: string;
  };
  return (
    e.code === "23505" &&
    (e.constraint_name === SLUG_UNIQUE_CONSTRAINT ||
      (typeof e.message === "string" &&
        e.message.includes(SLUG_UNIQUE_CONSTRAINT)))
  );
}

/** Normalise a name into a schema-valid slug base (lowercase
 *  alphanumerics + internal hyphens). Falls back to "org" when the
 *  name has no usable characters (e.g. all punctuation / non-latin). */
function baseSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "org";
}

/** First free slug derived from `name`, checked against the tx so the
 *  read participates in the same snapshot as the subsequent insert. */
async function deriveUniqueSlug(orgTx: OrgRepo, name: string): Promise<string> {
  const base = baseSlug(name);
  for (let i = 0; i < MAX_SLUG_ATTEMPTS; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await orgTx.findBySlug(candidate))) return candidate;
  }
  // Pathological collision volume — fall back to a random suffix. The
  // unique index on `slug` is the ultimate backstop if even this races.
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createOrg(
  params: CreateOrgParams,
  deps: CreateOrgDeps,
): Promise<CreateOrgResult> {
  const { actorUserId, input, audit } = params;

  // 1. FR5 — single-membership guard (correctness + race backstop on
  // top of the handler's fast `actor.localOrgId` check).
  const existing = await deps.membershipRepo.findByUser(actorUserId);
  if (existing) {
    // Route through failAndAudit so this — the most common rejection —
    // is counted in `org.create.failures` like every other failure path
    // (not merely audited). Pass the existing org for audit context.
    await failAndAudit(
      deps,
      actorUserId,
      audit,
      "already_member",
      existing.orgId,
    );
    throw new CreateOrgError("already_member");
  }

  // 2. WorkOS org first (its id is mirrored into the local row).
  let workosOrgId: string;
  try {
    const workosOrg = await deps.workos.createOrganization({
      name: input.name,
    });
    workosOrgId = workosOrg.id;
  } catch (err) {
    await failAndAudit(deps, actorUserId, audit, "workos_create_failed");
    throw new CreateOrgError("provisioning_failed", { cause: err });
  }

  // 3. Local mirror + owner membership, atomic — retried on a
  // concurrent slug collision (see MAX_CREATE_ATTEMPTS).
  let result: { org: Org; membership: OrgMembership } | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
    try {
      result = await deps.db.transaction(async (tx) => {
        const orgTx = deps.orgRepo.withTx(tx);
        const membershipTx = deps.membershipRepo.withTx(tx);

        // FR5 race backstop. The pre-tx `findByUser` above is the fast
        // path; this serialises two `POST /orgs` from the same user
        // that race past it (no `UNIQUE(user_id)` exists — see
        // `membershipRepo.lockForUserCreate`). The lock makes the second
        // caller wait, then the re-check sees the first's membership and
        // aborts as `already_member` (409, not a 500).
        await membershipTx.lockForUserCreate(actorUserId);
        const racing = await membershipTx.findByUser(actorUserId);
        if (racing) {
          throw new CreateOrgError("already_member");
        }

        const slug = await deriveUniqueSlug(orgTx, input.name);
        const org = await orgTx.create({
          workosOrgId,
          name: input.name,
          slug,
        });
        const membership = await membershipTx.create({
          orgId: org.id,
          userId: actorUserId,
          role: "owner",
        });
        return { org, membership };
      });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      // Concurrent same-slug INSERT from a *different* user (the
      // per-user advisory lock doesn't serialise across users). Retry —
      // `deriveUniqueSlug` now sees the committed row and picks the next
      // suffix. Bounded so a pathological hot slug can't spin forever.
      if (isSlugConflict(err) && attempt < MAX_CREATE_ATTEMPTS) {
        emitCount("org.create.slug_conflict_retry");
        continue;
      }
      break;
    }
  }

  if (!result) {
    // Compensate: best-effort delete the orphaned WorkOS org (created
    // pre-tx) regardless of why the transaction failed.
    await deps.workos.deleteOrganization(workosOrgId).catch((delErr) => {
      emitCount("org.create.compensation_failed");
      logger.error("org.create.compensation_failed", {
        workosOrgId,
        error: serializeError(delErr),
      });
    });
    // A lost FR5 race (the in-tx re-check found a membership) is a
    // client-state conflict, not a server fault — surface it as
    // already_member (409), having compensated the WorkOS org.
    if (
      lastErr instanceof CreateOrgError &&
      lastErr.reason === "already_member"
    ) {
      await failAndAudit(deps, actorUserId, audit, "already_member_race");
      throw lastErr;
    }
    await failAndAudit(
      deps,
      actorUserId,
      audit,
      isSlugConflict(lastErr)
        ? "slug_conflict_exhausted"
        : "db_transaction_failed",
    );
    throw new CreateOrgError("provisioning_failed", { cause: lastErr });
  }

  // 4a. Audit (post-commit; safeAudit never masks the real outcome).
  await safeAudit(deps, {
    eventType: "org_created",
    outcome: "success",
    actorUserId,
    orgId: result.org.id,
    sourceIp: audit.sourceIp,
    userAgent: audit.userAgent,
    metadata: { workosOrgId: result.org.workosOrgId, slug: result.org.slug },
  });
  await safeAudit(deps, {
    eventType: "membership_created",
    outcome: "success",
    actorUserId,
    orgId: result.org.id,
    sourceIp: audit.sourceIp,
    userAgent: audit.userAgent,
    metadata: { role: "owner", membershipId: result.membership.id },
  });

  // 4b. Emit `org.created` for room provisioning (FR3). Best-effort —
  // the org already exists; a publish failure is logged/metered, not
  // thrown, so the request still succeeds (the subscriber is idempotent
  // and reconciliation is an operator concern).
  const event: OrgCreatedEvent = {
    orgId: result.org.id,
    workosOrgId: result.org.workosOrgId,
    ownerUserId: actorUserId,
  };
  try {
    await deps.events.emitOrgCreated(event);
  } catch (err) {
    emitCount("org.provision.room_handoff_failed");
    logger.error("org.provision.room_handoff_failed", {
      orgId: event.orgId,
      error: serializeError(err),
    });
  }

  emitCount("org.created.count");
  return {
    orgId: result.org.id,
    role: "owner",
    org: result.org,
    membership: result.membership,
    event,
  };
}

async function failAndAudit(
  deps: CreateOrgDeps,
  actorUserId: string,
  audit: AuditContext,
  reason: string,
  orgId?: string,
): Promise<void> {
  emitCount("org.create.failures");
  await safeAudit(deps, {
    eventType: "org_created",
    outcome: "failure",
    actorUserId,
    orgId: orgId ?? null,
    sourceIp: audit.sourceIp,
    userAgent: audit.userAgent,
    metadata: { reason },
  });
}
