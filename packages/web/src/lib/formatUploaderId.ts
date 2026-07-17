// `DocumentVersionDTO.uploadedBy` is a bare user UUID — the room/folder
// listing endpoints don't join to a display name (see the T-013 build
// spec's "Data" section: `DocumentDTO`/`DocumentVersionDTO` carry no
// uploader name field). Rendering the full UUID in a table column is
// noisy, so this shortens it to a stable, still-identifying fragment; the
// full id remains available via the cell's `title` attribute in `Room.tsx`.
//
// Deferred: a real "uploader" column needs either a users lookup joined
// server-side, or a client-side `/orgs/:orgId/members` cache to resolve
// names — out of scope for T-013 (slice 2), flagged for whichever task
// picks up member-aware listings.
export function formatUploaderId(uploadedBy: string): string {
  return uploadedBy.slice(0, 8);
}
