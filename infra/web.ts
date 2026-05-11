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
    // Empty in dev so the SPA uses relative URLs caught by the Vite
    // dev proxy; absolute API Gateway URL in deployed stages.
    // `VITE_PROXY_TARGET` is read by the proxy itself via Node, not
    // via `import.meta.env`.
    VITE_CORE_API_URL: $dev ? "" : coreAPI.url,
    VITE_PROXY_TARGET: coreAPI.url,
  },
});
