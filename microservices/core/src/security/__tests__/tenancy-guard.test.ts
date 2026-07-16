// Tenant-isolation (slice 10) / T-005 — CI tripwire (FR6 / AC-US3).
//
// The mechanical backstop under ADR-011's application-layer isolation: it
// fails CI if any file OUTSIDE the sanctioned set reaches a tenant-scoped
// table directly (a raw Drizzle `db.select().from(orgMemberships)`, an
// `.insert/.update/.delete/.join`, or a `const { orgMemberships } = schema`
// destructure) instead of going through `scopedRepo(orgId)`. One forgotten
// `WHERE org_id = $1` is a cross-tenant breach; the factory makes the safe
// path the default, and this test makes the unsafe path un-mergeable.
//
// Mirrors the spirit of `security/__tests__/nfr-matrix.test.ts` (a grep-based
// tripwire the team already trusts). It is driven by the `TENANT_SCOPED_TABLES`
// registry (T-001), so a table added there is automatically guarded — and the
// detector is self-tested against a fixture below so it can never rot into a
// vacuously-green check.
//
// The sanctioned set (ALLOWLIST) is exactly "the factory + the repo files it
// owns" (design §Enforcement) PLUS the bootstrap carve-out: `userRepo` is
// identity (no scoped table), and `bootstrapRepo.ts` holds the four reads that
// legitimately precede/compute the tenant context (design "Identity & the
// bootstrap path"; see `project`-memory / T-004). Anything else is a violation.
//
// COVERED access vectors: the Drizzle query-builder calls (`.from/.insert/
// .update/.delete/.<join>(table)`), the relational query API
// (`db.query.<table>` — enabled by `drizzle(client, { schema })`), and pulling
// the raw table var into a file (`const { table } = schema`). KNOWN residual
// gaps, accepted for the v0.1 grep tripwire (design's explicit "grep, not
// ESLint/AST — enforced by discipline + tests" trade-off), each requiring a
// deliberate deviation from the house idiom rather than an accidental
// copy-paste: raw `sql\`… FROM org_memberships …\`` by snake name (grepping it
// would false-positive on the many comments/strings that name tables),
// aliased imports (`import { orgMemberships as m }`), and access from outside
// `microservices/core/src` (the only DB consumer today — revisit when a
// second service touches these tables). The property test (T-006) is the
// runtime backstop for the repo methods themselves.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TENANT_SCOPED_TABLES } from "../../infrastructure/db/tenancy";

// Absolute path to `microservices/core/src`. Paths in the report + the
// allowlist are relative to it.
const CORE_SRC = path.resolve(__dirname, "../..");

// The only production files permitted to touch a tenant-scoped table
// directly. Everything else must obtain a repo from `scopedRepo(orgId)`.
const ALLOWLIST = new Set(
  [
    "infrastructure/db/scoped.ts", // the factory
    "infrastructure/db/scopedRepoBase.ts", // ScopedRepo base
    "infrastructure/db/membershipRepo.ts", // scoped repos it owns …
    "infrastructure/db/invitationRepo.ts",
    "infrastructure/db/externalGrantRepo.ts",
    "infrastructure/db/auditRepo.ts",
    "infrastructure/db/bootstrapRepo.ts", // the bootstrap carve-out
    "infrastructure/db/tenancy.ts", // the registry (names, not access)
  ].map((p) => p.split("/").join(path.sep)),
);

/** snake_case SQL table name → its Drizzle schema variable (camelCase).
 *  `org_memberships` → `orgMemberships`. Matches the convention in
 *  `packages/db/src/schema/auth.ts`. */
function toDrizzleVar(sqlName: string): string {
  return sqlName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** A raw Drizzle query-builder call taking the table as its argument —
 *  `.from(x)`, `.insert(x)`, `.update(x)`, `.delete(x)`, or any join. Matches
 *  both the bare destructured var and `schema.<var>`. Deliberately does NOT
 *  match `deps.invitations` / `scoped.invitations` (the scoped-repo BUNDLE
 *  property), which is the safe path and shares the table's name. */
function accessRe(v: string): RegExp {
  return new RegExp(
    `\\.(?:from|insert|update|delete|innerJoin|leftJoin|rightJoin|fullJoin)\\(\\s*(?:schema\\.)?${v}\\b`,
  );
}

/** Drizzle's relational query API — `db.query.orgMemberships.findMany(...)`.
 *  Enabled here because the client is built with `drizzle(client, { schema })`
 *  (`packages/db/src/index.ts`), so this is a first-class typed READ path that
 *  would otherwise bypass the query-builder regex above entirely. */
function queryRe(v: string): RegExp {
  return new RegExp(`\\.query\\.${v}\\b`);
}

/** `const { orgMemberships } = schema` — pulling the raw table var into a
 *  file. A non-sanctioned file has no business reaching for it at all, so we
 *  flag the destructure itself, before any query is even written. */
function destructureRe(v: string): RegExp {
  return new RegExp(`\\{[^}]*\\b${v}\\b[^}]*\\}\\s*=\\s*schema\\b`);
}

interface Violation {
  file: string;
  table: string;
  kind: "query" | "import";
}

/** Scan a map of {relPath → contents}; report every non-allowlisted file that
 *  reaches a tenant-scoped table directly. Pure over its input so the same
 *  detector runs against the real tree AND the fixture below. */
function findViolations(files: Map<string, string>): Violation[] {
  const violations: Violation[] = [];
  for (const [rel, contents] of files) {
    if (ALLOWLIST.has(rel)) continue;
    for (const table of TENANT_SCOPED_TABLES) {
      const v = toDrizzleVar(table);
      if (accessRe(v).test(contents) || queryRe(v).test(contents)) {
        violations.push({ file: rel, table, kind: "query" });
      } else if (destructureRe(v).test(contents)) {
        violations.push({ file: rel, table, kind: "import" });
      }
    }
  }
  return violations;
}

/** Walk `microservices/core/src` for production `.ts`, skipping tests and the
 *  usual build dirs. Keys are POSIX-agnostic paths relative to CORE_SRC. */
function collectCoreSrc(): Map<string, string> {
  const out = new Map<string, string>();
  walk(CORE_SRC);
  return out;

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".ts") || full.endsWith(".test.ts")) continue;
      out.set(path.relative(CORE_SRC, full), readFileSync(full, "utf8"));
    }
  }
}

describe("tenancy tripwire (FR6 / AC-US3)", () => {
  it("no production file reaches a tenant-scoped table outside the sanctioned set", () => {
    const violations = findViolations(collectCoreSrc());
    expect(
      violations,
      `Raw access to a tenant-scoped table outside scopedRepo(). Route it ` +
        `through the factory (or, if it is a genuine pre-tenant-context ` +
        `bootstrap read, through bootstrapRepo.ts + this allowlist):\n` +
        violations
          .map((x) => `  ${x.file} → ${x.table} (${x.kind})`)
          .join("\n"),
    ).toEqual([]);
  });

  // Self-test: prove the detector actually fires (AC-US3 "a deliberately-
  // introduced raw unscoped query fails the test; removing it passes"). A
  // tripwire that can't catch a real violation is worse than none.
  it("catches a deliberately-introduced raw unscoped query (fixture)", () => {
    const leak = new Map<string, string>([
      [
        "application/evil/leak.ts",
        `import { schema } from "@ai-data-room/db";
         const { orgMemberships } = schema;
         export const all = (db) => db.select().from(orgMemberships);`,
      ],
    ]);
    const found = findViolations(leak);
    expect(found).toContainEqual({
      file: "application/evil/leak.ts",
      table: "org_memberships",
      kind: "query",
    });
  });

  it("catches the relational query API path db.query.<table> (fixture)", () => {
    // `db.query.orgMemberships.findMany(...)` is a typed read with no org
    // filter — a different vector from `.from(...)`, so guard it explicitly.
    const relational = new Map<string, string>([
      [
        "application/evil/relational.ts",
        `export const all = (db) => db.query.orgMemberships.findMany({});`,
      ],
    ]);
    expect(findViolations(relational)).toContainEqual({
      file: "application/evil/relational.ts",
      table: "org_memberships",
      kind: "query",
    });
  });

  it("does not flag the safe path — a scoped-repo bundle property (fixture)", () => {
    // `deps.invitations.create(...)` / `scoped.invitations` is the SANCTIONED
    // path and must never trip the wire despite sharing the table's name.
    const safe = new Map<string, string>([
      [
        "application/invitations.ts",
        `export async function create(deps) {
           return deps.invitations.create({ email: "x" });
         }
         const later = (scoped) => scoped.invitations.listByState("pending");`,
      ],
    ]);
    expect(findViolations(safe)).toEqual([]);
  });

  it("removing the raw query clears the violation (fixture)", () => {
    // The AC-US3 "removing it passes" half — same file, now going through the
    // factory instead of the raw table.
    const fixed = new Map<string, string>([
      [
        "application/evil/leak.ts",
        `export const all = (scoped) => scoped.membership.list();`,
      ],
    ]);
    expect(findViolations(fixed)).toEqual([]);
  });

  it("flags a bare schema destructure even before any query (fixture)", () => {
    const pull = new Map<string, string>([
      [
        "application/sneaky.ts",
        `import { schema } from "@ai-data-room/db";
         const { auditEvents } = schema;`,
      ],
    ]);
    expect(findViolations(pull)).toContainEqual({
      file: "application/sneaky.ts",
      table: "audit_events",
      kind: "import",
    });
  });
});
