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
