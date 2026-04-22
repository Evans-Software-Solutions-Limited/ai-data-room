/**
 * Result type for operations that can fail
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const Result = {
  ok<T, E>(value: T): Result<T, E> {
    return { ok: true, value };
  },
  err<T, E>(error: E): Result<T, E> {
    return { ok: false, error };
  },
};
