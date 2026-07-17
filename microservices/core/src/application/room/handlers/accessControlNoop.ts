// accessControlNoop — the T-011 access-control extension point.
//
// Per design.md §Interfaces: "Every handler runs access-control
// middleware before any domain logic." Slice 3 (access-control) is
// what actually implements per-opportunity grant checks; it hasn't
// shipped yet. Rather than have every room handler skip the seam
// entirely (which would force slice 3 to thread a NEW guard through
// every route), this `.onBeforeHandle()` is mounted in the room
// guard chain NOW as a deliberate no-op — it always proceeds
// (returns `undefined`).
//
// Slice 3 replaces this function's BODY with the real
// `requires(...)` check keyed on the route + the actor's grants
// (internal role, or an external user's active
// `external_access_grants` rows). Keep the export name stable so
// `roomRoutes.ts`'s `.onBeforeHandle(accessControlNoop)` wiring
// doesn't need to change when slice 3 lands.
//
// Deliberately takes no parameters — Elysia calls `.onBeforeHandle()`
// guards with the full request context, but this no-op doesn't need
// it (slice 3's real implementation will accept
// `ctx: Record<string, unknown>` and narrow it, same as
// `requireOrg`).
export function accessControlNoop(): undefined {
  return undefined;
}
