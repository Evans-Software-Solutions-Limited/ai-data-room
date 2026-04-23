// Unit tests for `getDb()` — the `@ai-data-room/db` public entry.
//
// The real DB integration (migrations applying cleanly, schema matching
// design.md) is covered by T-003's smoke test and T-005's repository
// integration tests, which run against an actual Postgres instance.
// These unit tests defend the wiring shape only:
//
//   1. `postgres()` is called with the Lambda-friendly pool options we
//      committed to in ADR-002.
//   2. The second call reuses the cached client (module-level singleton)
//      — critical because Lambda reuses warm containers and we don't
//      want to leak a new pool per invocation.

import { beforeEach, describe, expect, it, vi } from "vitest";

const postgresMock = vi.fn();
const drizzleMock = vi.fn();

vi.mock("postgres", () => ({
  default: (...args: unknown[]) => postgresMock(...args),
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: (...args: unknown[]) => drizzleMock(...args),
}));

// Reloaded per test so the module-level `_db` singleton resets between
// cases. Without this the "caches on second call" test would leak into
// the "pool options" test.
let getDb: typeof import("../index").getDb;

async function loadFreshModule() {
  vi.resetModules();
  postgresMock.mockReset();
  drizzleMock.mockReset();
  postgresMock.mockImplementation(() => ({ __client: true }));
  drizzleMock.mockImplementation((client: unknown) => ({
    __drizzle: true,
    client,
  }));
  const mod = await import("../index");
  getDb = mod.getDb;
}

describe("getDb", () => {
  beforeEach(async () => {
    await loadFreshModule();
  });

  it("calls postgres() with the Lambda-friendly pool options", () => {
    getDb("postgres://user:pass@host:5432/db");

    expect(postgresMock).toHaveBeenCalledTimes(1);
    const [connectionString, options] = postgresMock.mock.calls[0];
    expect(connectionString).toBe("postgres://user:pass@host:5432/db");
    expect(options).toMatchObject({
      max: 1,
      idle_timeout: 10,
      max_lifetime: 60 * 5,
      prepare: false,
    });
  });

  it("passes the postgres client and schema through to drizzle()", () => {
    getDb("postgres://ignored");

    expect(drizzleMock).toHaveBeenCalledTimes(1);
    const [client, config] = drizzleMock.mock.calls[0];
    expect(client).toEqual({ __client: true });
    expect(config).toHaveProperty("schema");
  });

  it("caches the drizzle client on subsequent calls (Lambda warm-reuse)", () => {
    const first = getDb("postgres://one");
    const second = getDb("postgres://two");

    expect(first).toBe(second);
    expect(postgresMock).toHaveBeenCalledTimes(1);
    expect(drizzleMock).toHaveBeenCalledTimes(1);
  });
});
