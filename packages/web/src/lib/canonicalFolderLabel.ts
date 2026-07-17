import type { CanonicalFolder } from "@ai-data-room/api-utils/schemas/rooms";

export interface CanonicalFolderLabel {
  /** The two-digit ordering prefix, e.g. "02" — rendered muted/mono. */
  number: string;
  /** The human-readable name with underscores replaced by spaces, e.g. "Financials". */
  name: string;
}

// Backend keys are `NN_Some_Name` (see `CANONICAL_FOLDERS` in
// `@ai-data-room/api-utils/schemas/rooms`) — strip the numeric prefix and
// swap underscores for spaces to get the display name, per the datum/room
// prototype's folder-row layout (mono number + serif/sans name).
export function canonicalFolderLabel(
  key: CanonicalFolder,
): CanonicalFolderLabel {
  const [number, ...rest] = key.split("_");
  return {
    number,
    name: rest.join(" "),
  };
}
