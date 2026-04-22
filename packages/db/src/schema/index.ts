// Barrel file — one module per feature slice. Modules land as slices
// reach the T-002-style migration task. See `specs/ai-data-room/<slice>/
// tasks.md` for the authoritative column list.

// Slice 1 — auth-and-orgs
export * from "./auth";

// Slice 2 — room-and-folders (exports land when slice 2 T-001 runs)
// export * from "./rooms";

// Slice 3 — access-control
// export * from "./access-control";

// Slice 4 — doc-checklist
// export * from "./checklist";

// Slice 5 — ai-doc-sensecheck
// export * from "./sensecheck";

// Slice 6 — ai-search-qna
// export * from "./qna";

// Slice 8 — billing-subscription
// export * from "./billing";

// Slice 9 — onboarding-flow
// export * from "./onboarding";
