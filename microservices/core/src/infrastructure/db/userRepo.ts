// Drizzle-backed repository for the `users` aggregate.
//
// Slice 1 / T-007. Exposes only the queries the application layer
// (T-008 signup/login, T-010 MFA mirroring, T-012 suspension, T-019
// GDPR delete) needs. No business logic — invariant enforcement lives
// one layer up in `application/*.ts`. Layered architecture per
// CLAUDE.md.
//
// Conventions (mirrored across the six T-007 repos):
//
//   - Constructor injection of `Db`. The same pattern as
//     application/repositories/helloWorldRepository.ts: handlers
//     construct one repo per request scope passing the Lambda-cached
//     `Db`. Tests construct with a test pool from
//     `@ai-data-room/db/test/integration/setup`.
//   - Method returns are domain types (re-exported from
//     `@ai-data-room/api-utils/schemas/auth-orgs`). The drizzle row
//     shape happens to match — they're both derived from design.md
//     §Data model — but routing through the domain type keeps the
//     application layer free of any drizzle-orm import.
//   - `null` (not `undefined`) signals "not found" on lookup methods.
//     Matches FDP and is consistent across the slice.

import { eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "@ai-data-room/db";
import { schema } from "@ai-data-room/db";
import type {
  LifecycleState,
  User,
} from "@ai-data-room/api-utils/schemas/auth-orgs";

import { firstOrNull, firstOrThrow } from "./_helpers";

const { users } = schema;

export interface CreateUserInput {
  workosUserId: string;
  email: string;
  fullName?: string | null;
  /**
   * Both fields below are optional and primarily seeded by the
   * signup flow (T-008): the WorkOS auth response carries the
   * `emailVerified` flag, and AuthKit gates signup on MFA enrolment
   * so MFA is provably enrolled at the moment we get here. Without
   * stamping these at create-time, fresh users would fail the
   * login-time MFA gate (`mfaEnrolledAt === null` →
   * `mfa_required`) until the T-010 webhook backfills — which is
   * a startup-state lockout we want to avoid.
   */
  emailVerifiedAt?: Date | null;
  mfaEnrolledAt?: Date | null;
}

export class UserRepo {
  private readonly db: DbOrTx;
  constructor(db: DbOrTx) {
    this.db = db;
  }

  /**
   * Returns a new instance bound to a Drizzle transaction handle.
   * Application functions wrap multi-write sequences in
   * `db.transaction(async (tx) => repo.withTx(tx).create(...))` so a
   * mid-sequence failure rolls every write back atomically. The
   * factory shape (rather than a `tx?` parameter on every method)
   * keeps the call sites unchanged inside the callback.
   */
  withTx(tx: Tx): UserRepo {
    return new UserRepo(tx);
  }

  /**
   * Insert a fresh `users` row for the WorkOS-authenticated user.
   * Returns the inserted row. The unique partial index on
   * `users(email) WHERE lifecycle_state <> 'deleted'` (T-005) means
   * a duplicate active email throws — callers are expected to have
   * already checked via `findByEmail` or to handle the race by
   * retrying as `findByWorkosUserId`.
   */
  async create(input: CreateUserInput): Promise<User> {
    const [row] = await this.db
      .insert(users)
      .values({
        workosUserId: input.workosUserId,
        email: input.email,
        fullName: input.fullName ?? null,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        mfaEnrolledAt: input.mfaEnrolledAt ?? null,
      })
      .returning();
    return row as User;
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id));
    return firstOrNull(rows as User[]);
  }

  /**
   * The signup/login callback's primary lookup — exchange a WorkOS
   * authentication for our local user row. WorkOS user IDs are stable,
   * so the unique index on `workos_user_id` is the right key.
   */
  async findByWorkosUserId(workosUserId: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.workosUserId, workosUserId));
    return firstOrNull(rows as User[]);
  }

  /**
   * Case-insensitive (the column is citext, see T-005). Used by the
   * invite flow to detect "this email is already a user" before
   * issuing a fresh invitation.
   */
  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    return firstOrNull(rows as User[]);
  }

  async setLifecycleState(id: string, state: LifecycleState): Promise<User> {
    const rows = await this.db
      .update(users)
      .set({ lifecycleState: state, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return firstOrThrow(rows as User[], "User", id);
  }

  async setMfaEnrolledAt(id: string, when: Date): Promise<User> {
    const rows = await this.db
      .update(users)
      .set({ mfaEnrolledAt: when, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return firstOrThrow(rows as User[], "User", id);
  }

  async setEmailVerifiedAt(id: string, when: Date): Promise<User> {
    const rows = await this.db
      .update(users)
      .set({ emailVerifiedAt: when, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return firstOrThrow(rows as User[], "User", id);
  }

  /**
   * GDPR hard-delete (NFR9): null PII columns and flip lifecycle to
   * `deleted`. `workos_user_id` is intentionally retained as a
   * tombstone so audit rows remain joinable. The partial unique on
   * `users(email)` excludes deleted rows, so a fresh signup can
   * reuse the address without colliding with the tombstone.
   */
  async scrubPii(id: string): Promise<User> {
    const rows = await this.db
      .update(users)
      .set({
        email: null,
        fullName: null,
        lifecycleState: "deleted",
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return firstOrThrow(rows as User[], "User", id);
  }
}
