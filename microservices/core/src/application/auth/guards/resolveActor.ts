// resolveActor — Elysia `.resolve()` guard that translates the WorkOS
// identity carried by `requireAuth`'s `AuthContext` into the local-DB
// identity (UUIDs) that application functions consume.
//
// Slice 1 / T-015 + T-014b. Mirrors the WorkOS-→-local UUID lookups
// already used inside the application layer (`login.ts`,
// `acceptInvitation`, `mfa.ts`, `deletion.ts`) but lifts them up to
// run once per protected request, so handlers can pass
// `actor.localUserId` / `actor.localOrgId` straight through to the
// application functions without each one redoing the lookup.
//
// **Lazy-mirror path** for organic AuthKit signups
// (`/auth/signup` → `/auth/callback` → web shell). The callback
// handler is intentionally thin (sticky #45) — it sets the sealed
// session cookie and redirects without creating a local `users` row.
// On the user's first protected request, `findByWorkosUserId` misses,
// so we lazy-create the row from the WorkOS session payload here.
// `mfaEnrolledAt` and `emailVerifiedAt` are stamped at create-time
// for the same reason as T-008's signup path (sticky #18) — without
// them, the next request through the FR16 MFA gate would reject
// despite WorkOS / AuthKit having already enforced enrolment.
//
// **Org and membership are NOT lazy-created.** A WorkOS user fresh
// off `/auth/signup` has no WorkOS organization, so
// `input.organizationId` is `null` and we set `actor.localOrgId =
// null`. Org provisioning lands in slice 9 (`onboarding-flow`); /me
// returns a `{ orgId: null, role: null, ... }` shape per FR14 until
// then.
//
// **No transaction.** Lazy-create is a single-row insert; the unique
// index on `users.workos_user_id` catches a concurrent race (two
// tabs from the same fresh signup) and we recover by re-finding.
// Wrapping in a transaction would just add round trips for no
// safety win.

import type { OrgRepo } from "../../../infrastructure/db/orgRepo";
import type { UserRepo } from "../../../infrastructure/db/userRepo";
import type { User } from "@ai-data-room/api-utils/schemas/auth-orgs";
import type { User as WorkOSUser } from "../../../infrastructure/workos/client";
import type { ActorContext, AuthContext } from "./authContextTypes";

export interface ResolveActorDeps {
  userRepo: UserRepo;
  orgRepo: OrgRepo;
}

export async function resolveActor(
  input: AuthContext,
  deps: ResolveActorDeps,
): Promise<ActorContext> {
  const localUser = await findOrLazyMirrorUser(input.user, deps.userRepo);

  let localOrgId: string | null = null;
  if (input.organizationId) {
    const org = await deps.orgRepo.findByWorkosOrgId(input.organizationId);
    if (org) {
      localOrgId = org.id;
    } else {
      // WorkOS says we have an org, but our local mirror is missing.
      // Possible causes:
      //   - Webhook race: `org.created` mirror not yet processed.
      //   - Data inconsistency: real bug worth investigating.
      //
      // We graceful-degrade to "no org" so /me still works (the user
      // sees the unprovisioned shape and the slice-9 onboarding flow
      // can recover). A `console.warn` keeps the breadcrumb visible
      // in CloudWatch without paging anyone — if it ever fires in
      // production volume, T-018 will surface it as a metric.
      console.warn(
        "[resolveActor] WorkOS organizationId without local mirror",
        {
          workosUserId: input.user.id,
          workosOrgId: input.organizationId,
        },
      );
    }
  }

  return {
    actor: {
      localUserId: localUser.id,
      localOrgId,
    },
  };
}

async function findOrLazyMirrorUser(
  workosUser: WorkOSUser,
  userRepo: UserRepo,
): Promise<User> {
  const existing = await userRepo.findByWorkosUserId(workosUser.id);
  if (existing) {
    return existing;
  }

  const now = new Date();
  const fullName = composeFullName(workosUser);

  try {
    return await userRepo.create({
      workosUserId: workosUser.id,
      email: workosUser.email,
      fullName,
      // Stamped to match signup-time policy (sticky #18). AuthKit
      // already gates signup on MFA enrolment + email verification,
      // so a lazy-mirrored user is provably enrolled at the moment
      // they reach this guard.
      mfaEnrolledAt: now,
      emailVerifiedAt: workosUser.emailVerified ? now : null,
    });
  } catch {
    // Most likely a unique-violation on `workos_user_id` from a
    // concurrent lazy-create (multiple tabs from the same fresh
    // signup). Re-find — the existing row is what we want.
    const recovered = await userRepo.findByWorkosUserId(workosUser.id);
    if (recovered) {
      return recovered;
    }
    // We caught a real failure that wasn't a duplicate insert. Throw
    // and let Elysia 500 — silently returning a stub user would
    // mask the bug downstream.
    throw new Error(
      `resolveActor: lazy-mirror failed for workosUserId=${workosUser.id}`,
    );
  }
}

function composeFullName(workosUser: WorkOSUser): string | null {
  const parts = [workosUser.firstName, workosUser.lastName]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length === 0 ? null : parts.join(" ");
}
