import { CANONICAL_FOLDERS } from "@ai-data-room/api-utils/schemas/rooms";

import { canonicalFolderDescription } from "../folderDescriptions";

describe("canonicalFolderDescription", () => {
  it("returns a non-empty description for every canonical folder", () => {
    for (const folder of CANONICAL_FOLDERS) {
      expect(canonicalFolderDescription(folder).length).toBeGreaterThan(0);
    }
  });
});
