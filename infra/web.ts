import { coreAPI } from "./api";
import { documentsBucket } from "./storage";

const region = aws.getRegionOutput().name;

// Web front-end. The template was a Vite SPA; ai-data-room will move to
// Next.js per `specs/ai-data-room/onboarding-flow/design.md` (server
// components for the wizard, BFF aggregates for the dashboard). Keep the
// Vite scaffold while we ship `auth-and-orgs` smoke routes; switch to
// `sst.aws.Nextjs` in slice 2 when room UX needs SSR.
export const frontend = new sst.aws.StaticSite("web", {
  path: "packages/web",
  build: {
    output: "dist",
    command: "bun run build",
  },
  environment: {
    VITE_REGION: region,
    VITE_CORE_API_URL: coreAPI.url,
    VITE_DOCUMENTS_BUCKET: documentsBucket.name,
  },
});
