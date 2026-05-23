// Slice-1 NFR checklist test.
//
// One assertion per NFR1-11 in `auth-and-orgs/requirements.md`. Mix
// of behavioural assertions (NFR4, NFR7), code-grep assertions
// (NFR2 / NFR8 / NFR10 — "this MUST NOT appear in the codebase"),
// and structural source-checks where another suite already proves
// the runtime behaviour (NFR1, NFR5, NFR9). `docs/security.md` has
// the human-readable matrix mapping each NFR to its impl + this
// file's verification site.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import Elysia from "elysia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { metrics } from "../../infrastructure/observability/metrics";
import { LOGIN_RATE_LIMIT, rateLimit } from "../../middleware/rateLimit";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

// File-contents cache: walked once at module load, reused across
// every grep assertion. ~158 TS files × 8 patterns is otherwise
// 1264 redundant `readFileSync`s per matrix run.
const FILE_CACHE = collectRepoFiles(REPO_ROOT);

// ─── NFR1: authenticated endpoints return 401 on missing session ──

describe("NFR1 — authenticated endpoints require a valid session", () => {
  it("the protected route bundle gates every handler through requireAuth", () => {
    // Behavioural assertion (401 on missing cookie for /me and the
    // six org-scoped routes) lives in `protectedRoutes.test.ts` —
    // it exercises the real Elysia stack with SST mocked. The
    // matrix-level check here is the structural invariant: both
    // sub-bundles (`meRoutes` + `orgScopedRoutes`) MUST be
    // `.resolve(requireAuth)`-gated.
    const file = path.join(
      REPO_ROOT,
      "microservices/core/src/application/auth/protectedRoutes.ts",
    );
    const src = readFileSync(file, "utf8");
    const guardSites = src.match(/\.resolve\(requireAuth\)/g) ?? [];
    expect(guardSites.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── NFR2: no plaintext passwords in our codebase ─────────────────

describe("NFR2 — passwords never enter our system in plaintext", () => {
  it("has no `password:` field on any application/domain type", () => {
    // AuthKit owns the password lifecycle entirely. The assertion
    // is that no shape in our types declares a `password` property.
    // The WorkOS SDK's input types in `node_modules` are out of
    // scope — we never call those paths.
    const offenders = grepRepo(/\bpassword\s*:\s*(z\.|string|String)/, {
      includeGlobs: ["microservices/**/*.ts", "packages/**/*.ts"],
      excludeGlobs: TEST_AND_FIXTURE_GLOBS,
    });
    expect(
      offenders,
      `Found plaintext password fields: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

// ─── NFR3: TLS-only ingress ───────────────────────────────────────

describe("NFR3 — auth traffic is TLS-only", () => {
  it("the deployed API URL is https (API Gateway HTTP API is HTTPS by default)", () => {
    // SST's `sst.aws.ApiGatewayV2` provisions an HTTPS endpoint —
    // there is no HTTP listener to disable. The check here is that
    // we never construct a non-`https` API URL anywhere in infra.
    const offenders = grepRepo(/http:\/\/(?!localhost|127\.)/, {
      includeGlobs: ["infra/**/*.ts"],
      excludeGlobs: ["**/_sst-globals.d.ts"],
    });
    expect(
      offenders,
      `Non-localhost http:// URLs found in infra: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

// ─── NFR4: rate limiting ──────────────────────────────────────────

describe("NFR4 — login attempts are rate-limited", () => {
  beforeEach(() => {
    vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the configured login limit matches the spec (10/IP/minute)", () => {
    expect(LOGIN_RATE_LIMIT.limit).toBe(10);
    expect(LOGIN_RATE_LIMIT.windowMs).toBe(60_000);
  });

  it("the plugin actually blocks once the limit is exceeded", async () => {
    const app = new Elysia()
      .use(rateLimit({ limit: 2, windowMs: 60_000 }))
      .get("/auth/sign-in", () => "ok");
    const ip = { headers: { "x-forwarded-for": "203.0.113.99" } };
    const url = "http://localhost/auth/sign-in";

    expect((await app.handle(new Request(url, ip))).status).toBe(200);
    expect((await app.handle(new Request(url, ip))).status).toBe(200);
    expect((await app.handle(new Request(url, ip))).status).toBe(429);
  });
});

// ─── NFR5: invite / reset tokens are unguessable + single-use ─────

describe("NFR5 — invite/verification/reset tokens are 128-bit unguessable + single-use", () => {
  it("delegates token issuance to WorkOS (no homegrown invite/reset token generation)", () => {
    const offenders = grepRepo(
      /\b(generateToken|generateInviteToken|generateResetToken|randomToken)\s*\(/,
      {
        includeGlobs: ["microservices/**/*.ts", "packages/**/*.ts"],
        excludeGlobs: TEST_AND_FIXTURE_GLOBS,
      },
    );
    expect(offenders).toEqual([]);
  });

  it("invitation transition is compare-and-set (single-use enforced at SQL)", () => {
    // The single-use guarantee comes from
    // `InvitationRepo.transitionState(id, expectedState, newState)`
    // — the WHERE clause prevents a second transition. Behaviour
    // is proven against real Postgres in
    // `invitationRepo.integration.test.ts`; the file-presence
    // check here makes the matrix self-contained.
    const repoFile = path.join(
      REPO_ROOT,
      "microservices/core/src/infrastructure/db/invitationRepo.ts",
    );
    const repo = readFileSync(repoFile, "utf8");
    expect(repo).toContain("transitionState");
    expect(repo).toMatch(/eq\(invitations\.state,\s*expectedState\)/);
  });
});

// ─── NFR6: MFA seeds + recovery codes encrypted at rest ───────────

describe("NFR6 — MFA seeds + recovery codes are not stored by us", () => {
  it("has no `recovery_codes` table, no plaintext code storage", () => {
    // ADR-003: AuthKit owns the entire recovery-codes UX. The
    // negative check here is that we never declare a column or
    // type that would store one.
    const offenders = grepRepo(
      /recovery_?[Cc]odes\s*:\s*(z\.|string|jsonb|text)/,
      {
        includeGlobs: ["microservices/**/*.ts", "packages/**/*.ts"],
        excludeGlobs: TEST_AND_FIXTURE_GLOBS,
      },
    );
    expect(offenders).toEqual([]);
  });
});

// ─── NFR7: session cookie attributes ──────────────────────────────

describe("NFR7 — session cookies are HttpOnly + Secure + SameSite", () => {
  it("setSecureCookie always sets the four invariant attributes", () => {
    const file = path.join(
      REPO_ROOT,
      "microservices/core/src/application/auth/config/frontendUrl.ts",
    );
    const src = readFileSync(file, "utf8");
    expect(src).toContain("httpOnly: true");
    expect(src).toContain("secure: isSecureOrigin");
    expect(src).toMatch(/sameSite:\s*"lax"/);
    expect(src).toContain('path: "/"');
  });

  it("isSecureOrigin is true outside SST_DEV (i.e., deployed stages)", async () => {
    const mod = await import("../../application/auth/config/frontendUrl");
    // The flag is computed at module load from `process.env.SST_DEV`;
    // in the test runner that env var is undefined, so the flag is
    // `true` — matching what deployed stages will see.
    expect(mod.isSecureOrigin).toBe(true);
  });
});

// ─── NFR8: forbidden material never enters logs ───────────────────

describe("NFR8 — logs exclude passwords, MFA codes, recovery codes, tokens", () => {
  it("no logger.* / console.* call site directly logs a forbidden field name", () => {
    // The audit-event validator (`application/audit.ts`) already
    // strips forbidden metadata. This grep catches direct log
    // calls that bypass the validator — `logger.info("...", {
    // password: ... })` and friends.
    const forbiddenKeys = [
      "password",
      "passwordHash",
      "recoveryCode",
      "recoveryCodes",
      "sessionToken",
      "wos_session",
      "sealedSession",
      "resetToken",
      "inviteToken",
    ];
    const pattern = new RegExp(
      `(logger|console)\\.(info|warn|error|debug|log)\\s*\\([^)]*\\b(${forbiddenKeys.join("|")})\\s*:`,
    );
    const offenders = grepRepo(pattern, {
      includeGlobs: ["microservices/**/*.ts", "packages/**/*.ts"],
      excludeGlobs: TEST_AND_FIXTURE_GLOBS,
    });
    expect(
      offenders,
      `Forbidden field name in a log call: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

// ─── NFR9: GDPR hard-delete preserves audit continuity ────────────

describe("NFR9 — GDPR hard-delete is supported without breaking audit joins", () => {
  it("handleUserDeleted scrubs PII but preserves workos_user_id + audit references", () => {
    const file = path.join(
      REPO_ROOT,
      "microservices/core/src/application/deletion.ts",
    );
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/scrubPii|scrubUserPii|setLifecycleState/);
    expect(src).not.toMatch(/DELETE FROM users/i);
  });
});

// ─── NFR10: audit log immutability is feasible ────────────────────

describe("NFR10 — audit log is append-only at the application layer", () => {
  it("no application file calls auditRepo.update or auditRepo.delete", () => {
    const offenders = grepRepo(
      /\bauditRepo\.(update|delete|patch|truncate)\b/,
      {
        includeGlobs: ["microservices/**/*.ts"],
        excludeGlobs: TEST_AND_FIXTURE_GLOBS,
      },
    );
    expect(offenders).toEqual([]);
  });
});

// ─── NFR11: anomaly-detection metrics + alarms ────────────────────

describe("NFR11 — metrics + alarms exist for anomalous auth patterns", () => {
  it("the four CloudWatch alarms are declared in infra/observability.ts", () => {
    const file = path.join(REPO_ROOT, "infra/observability.ts");
    const src = readFileSync(file, "utf8");
    expect(src).toContain("alarm-failed-login-spike");
    expect(src).toContain("alarm-webhook-invalid-signature");
    expect(src).toContain("alarm-session-validation-p95");
    expect(src).toContain("alarm-audit-write-failure");
  });
});

// ─── helpers ──────────────────────────────────────────────────────

// Standard exclusions for "real production code only" greps. `*.test.ts`
// on its own only matches zero-depth paths (which don't exist in this
// repo), so the `**/` prefix is load-bearing — without it integration
// test fixtures slip through and trip the password/recovery-code grep
// on intentional test data.
const TEST_AND_FIXTURE_GLOBS = [
  "**/__tests__/**",
  "**/*.test.ts",
  "**/*.integration.test.ts",
];

interface GrepOptions {
  includeGlobs: string[];
  excludeGlobs?: string[];
}

function grepRepo(pattern: RegExp, options: GrepOptions): string[] {
  const matches: string[] = [];
  for (const [rel, contents] of FILE_CACHE) {
    if (!matchesAny(rel, options.includeGlobs)) continue;
    if (options.excludeGlobs && matchesAny(rel, options.excludeGlobs)) continue;
    if (pattern.test(contents)) matches.push(rel);
  }
  return matches;
}

function collectRepoFiles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  walk(root);
  return out;

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      // Skip the obviously irrelevant dirs without statting them.
      if (
        entry === "node_modules" ||
        entry === ".sst" ||
        entry === ".turbo" ||
        entry === "dist" ||
        entry === "coverage" ||
        entry === ".git" ||
        entry === ".claude"
      ) {
        continue;
      }
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      out.set(path.relative(root, full), readFileSync(full, "utf8"));
    }
  }
}

function matchesAny(rel: string, globs: string[]): boolean {
  return globs.some((g) => matchGlob(rel, g));
}

// Minimal `**` / `*` matcher — covers the patterns this file uses
// without pulling in `globby` or `picomatch` for a 30-line need.
function matchGlob(value: string, glob: string): boolean {
  const escaped = glob
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => {
      if (part === "**/") return "(?:[^/]+/)*";
      if (part === "**") return ".*";
      if (part === "*") return "[^/]*";
      return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${escaped}$`).test(value);
}
