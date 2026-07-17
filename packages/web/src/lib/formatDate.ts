// Shared "added date" formatter for the room/folder document list. Fixed
// `en-GB` locale (not the browser locale) so rendered output — and
// therefore tests — are deterministic regardless of CI/dev-machine locale.
const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatDate(iso: string): string {
  return DATE_FORMATTER.format(new Date(iso));
}
