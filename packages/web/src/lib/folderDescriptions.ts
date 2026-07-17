import type { CanonicalFolder } from "@ai-data-room/api-utils/schemas/rooms";

// Short, neutral per-folder blurbs for the folder-detail header.
//
// NOTE (T-013 scope gap): the Claude Design prototype has bespoke
// per-folder copy, but that copy text wasn't supplied to this task (only
// `tokens.css` + the build spec were) — writing marketing-style prose here
// would be fabricating content nobody signed off on. These lines are
// deliberately plain, functional descriptions of what each canonical
// folder holds, not final product copy; swap them for the real prototype
// copy (or a copywriter pass) whenever that's available.
const FOLDER_DESCRIPTIONS: Record<CanonicalFolder, string> = {
  "01_Company_Overview":
    "Company structure, cap table, and general background documents.",
  "02_Financials": "Financial statements, projections, and supporting detail.",
  "03_Commercial": "Customer contracts, pipeline, and go-to-market material.",
  "04_Product": "Product documentation, architecture, and roadmap material.",
  "05_Legal": "Corporate, IP, and other legal documentation.",
  "06_Operations":
    "Operational policies, org charts, and process documentation.",
  "07_Information_Security":
    "Security policies, certifications, and compliance evidence.",
};

export function canonicalFolderDescription(folder: CanonicalFolder): string {
  return FOLDER_DESCRIPTIONS[folder];
}
