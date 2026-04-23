import { coreAPI } from "./api";

const region = aws.getRegionOutput().name;

// Web front-end. The template was a Vite SPA; ai-data-room will move to
// Next.js per `specs/ai-data-room/onboarding-flow/design.md` (server
// components for the wizard, BFF aggregates for the dashboard). Keep the
// Vite scaffold while we ship `auth-and-orgs` smoke routes; switch to
// `sst.aws.Nextjs` in slice 2 when room UX needs SSR.
//
// `VITE_DOCUMENTS_BUCKET` is intentionally absent — the bucket is slice-2
// infra and isn't declared until `room-and-folders`. Re-add here once
// `infra/storage.ts` exports `documentsBucket`.
export const frontend = new sst.aws.StaticSite("web", {
  path: "packages/web",
  build: {
    output: "dist",
    command: "bun run build",
  },
  environment: {
    VITE_REGION: region,
    VITE_CORE_API_URL: coreAPI.url,
  },
});
