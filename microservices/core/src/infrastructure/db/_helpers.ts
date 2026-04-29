// Internal helpers shared across the T-007 repos. Not exported from
// the package barrel — leading underscore signals "this is for repos
// in this folder, don't import from the application layer".

/**
 * Return the first row of a select-one query, or `null` if the query
 * matched nothing. Centralises the `(rows[0] as T | undefined) ?? null`
 * pattern that every `findById` / `findByX` method needs — keeping it
 * in one place means a future change to that pattern (say, when we
 * introduce drizzle's `findFirst`) only edits one file.
 *
 * The `as T` cast inside callers is still required because drizzle's
 * select rows are typed against the schema, while we want to return
 * the canonical domain type from `@ai-data-room/api-utils/schemas/auth-orgs`.
 * The two shapes are aligned by construction (both derive from
 * design.md §Data model); see each repo's file header for the rationale.
 */
export function firstOrNull<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

/**
 * Thrown by repository UPDATE methods when the WHERE clause matches
 * zero rows. The application layer catches and translates to a
 * domain-appropriate response (404 for direct lookups, no-op for
 * idempotent webhook redelivery — the choice belongs upstream, not
 * here).
 *
 * Why throw rather than return `T | null`: the lifecycle setters
 * (`setLifecycleState`, `setMfaEnrolledAt`, `scrubPii`, …) all run
 * after the application layer has already loaded the row by id —
 * a missing row at update time is a race / data-integrity bug, not
 * a user-facing 404. Returning null would force every callsite into
 * defensive null-checks for an outcome that's almost always wrong.
 * Throwing surfaces the bug at the right layer; callers that *do*
 * accept "not found" (idempotent webhook handlers) wrap with
 * try/catch.
 */
export class RepoNotFoundError extends Error {
  constructor(
    public readonly aggregate: string,
    public readonly id: string,
  ) {
    super(`${aggregate} ${id} not found`);
    this.name = "RepoNotFoundError";
  }
}

/**
 * Take the first row of an UPDATE-then-RETURNING result, or throw
 * `RepoNotFoundError` if zero rows matched. Centralises the same
 * "destructure then null-check" pattern across every update method
 * so the type signature can honestly promise a non-null return.
 */
export function firstOrThrow<T>(rows: T[], aggregate: string, id: string): T {
  const row = rows[0];
  if (row === undefined) throw new RepoNotFoundError(aggregate, id);
  return row;
}
