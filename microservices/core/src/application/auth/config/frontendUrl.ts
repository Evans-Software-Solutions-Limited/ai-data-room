// Stage-aware URL helpers for the public auth handlers.
//
// Slice 1 / T-014a. Mirrors the FDP shape — env vars set by
// `infra/api.ts`, read here at request time. We don't go through
// `Resource.*` for these because:
//   - `FRONTEND_URL` would create a circular SST dependency (the
//     web stack imports `coreAPI.url`; binding `web.url` back into
//     coreAPI's link list would deadlock).
//   - `API_URL` is just `coreAPI.url` self-referenced — wiring it
//     as an env var keeps the read path consistent with FRONTEND_URL.
//
// `SST_DEV` is set to `"true"` when the process is `sst dev` (the
// local SST runtime). All deployed stages have it unset, so the
// `isSecureOrigin` flag flips on automatically — the cookie's
// `Secure` attribute follows.
//
// Env access is via `globalThis.process` rather than the bare
// `process` global because this file's transitive type graph is
// reachable from `packages/web` (via the `CoreApi` Eden Treaty
// export), and the web tsconfig doesn't include `@types/node`.
// The minimal local declaration below gives TypeScript what it
// needs without dragging in node types for the browser package.

interface NodeProcessLike {
  env: Record<string, string | undefined>;
}
const proc = (globalThis as { process?: NodeProcessLike }).process;

const FRONTEND_URL_FALLBACK = "http://localhost:5173";
const API_URL_FALLBACK = "http://localhost:5173/api";

/**
 * The web shell's origin. Used as the post-sign-in / post-sign-out
 * redirect target.
 */
export function getFrontendUrl(): string {
  return proc?.env.FRONTEND_URL ?? FRONTEND_URL_FALLBACK;
}

/**
 * The post-auth landing URL. v0.1 returns users to the frontend
 * root; later slices (`onboarding-flow`) will switch to a
 * stage-specific deep link.
 */
export function getPostAuthRedirectUrl(): string {
  return getFrontendUrl();
}

/**
 * The OAuth redirect URI registered with WorkOS AuthKit. Must
 * exactly match what's configured in the WorkOS dashboard for the
 * stage — a mismatch surfaces as `invalid_redirect_uri` in the
 * AuthKit error response.
 */
export function getOAuthRedirectUri(): string {
  const apiUrl = proc?.env.API_URL ?? API_URL_FALLBACK;
  return `${apiUrl}/auth/callback`;
}

/**
 * `true` for deployed stages, `false` for local `sst dev`. Drives
 * the cookie `Secure` flag — browsers reject `Secure` cookies on
 * `http://localhost`, so we turn it off in dev.
 */
export const isSecureOrigin = proc?.env.SST_DEV !== "true";

/** True only on the production stage; used by the e2e-bootstrap 404 gate. */
export const isProduction = proc?.env.SST_STAGE === "production";

// ─── Cookie config ───────────────────────────────────────────────
// Centralised so a future change to the security defaults
// (e.g. `sameSite: "strict"`) only edits one file. Each handler
// passes its own `name`, `value`, and `maxAge` on top.

/** OAuth state cookie — covers the AuthKit redirect round-trip
 * plus any user dwell time on the hosted UI. Short-lived because
 * an abandoned flow shouldn't leave a stale state cookie around. */
export const OAUTH_STATE_COOKIE_MAX_AGE = 60 * 10;

/** Sealed session cookie — 30 days is the browser-side TTL.
 * WorkOS' sealed session encodes its own (shorter) authoritative
 * expiry inside the blob; `loadSealedSession().authenticate()` will
 * fail well before 30 days are up if the encoded session expired. */
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Set a security-defaulted cookie. The four invariant attributes
 * (`httpOnly`, `secure`, `sameSite`, `path`) are baked in so
 * adding a new cookie can't accidentally drop one of them — that's
 * the kind of regression a future CSRF / XSS audit catches the
 * hard way otherwise.
 */
export function setSecureCookie(
  cookie: {
    set: (options: {
      value: string;
      httpOnly: boolean;
      secure: boolean;
      sameSite: "lax" | "strict" | "none";
      path: string;
      maxAge: number;
    }) => void;
  },
  value: string,
  maxAge: number,
): void {
  cookie.set({
    value,
    httpOnly: true,
    secure: isSecureOrigin,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}
