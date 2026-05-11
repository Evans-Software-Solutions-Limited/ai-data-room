// Empty in dev so the Vite proxy (see `vite.config.ts`) handles
// `/auth/*`, `/me`, and `/orgs/*` same-origin — necessary for
// `SameSite=Lax` session cookies to survive the SPA's XHR calls.
export const CORE_API_URL = import.meta.env.VITE_CORE_API_URL ?? "";
