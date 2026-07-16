// Tenant-isolation (slice 10) / T-007 — the guard-violation signal fires.
//
// Two layers: the recorder in isolation (metric name + count + structured
// log), and the real catch path — `ScopedRepo.stampOrgId` rejecting a foreign
// org_id must emit `tenancy.guard.violations` (the metric the P1 alarm reads)
// before it throws.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricUnit } from "@aws-lambda-powertools/metrics";

import { metrics } from "../metrics";
import { logger } from "../../logging/logger";
import {
  recordTenancyGuardViolation,
  TENANCY_GUARD_VIOLATIONS_METRIC,
} from "../tenancyGuard";
import { ScopedRepo, ScopedRepoError } from "../../db/scopedRepoBase";
import type { DbOrTx, Tx } from "@ai-data-room/db";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

// Minimal concrete repo exposing the protected stampOrgId, so we can drive
// the real defence-in-depth catch (mirrors the fixture in scoped.test.ts).
class FixtureRepo extends ScopedRepo {
  withTx(tx: Tx): FixtureRepo {
    return new FixtureRepo(tx, this.orgId);
  }
  stamp<T>(values: T): T & { orgId: string } {
    return this.stampOrgId(values);
  }
}

describe("recordTenancyGuardViolation", () => {
  beforeEach(() => {
    vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("emits the tenancy.guard.violations count + a structured error log", () => {
    recordTenancyGuardViolation({
      boundOrgId: ORG_A,
      attemptedOrgId: ORG_B,
      repo: "MembershipRepo",
      operation: "write",
    });

    expect(metrics.addMetric).toHaveBeenCalledWith(
      TENANCY_GUARD_VIOLATIONS_METRIC,
      MetricUnit.Count,
      1,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "tenancy.guard.violation",
      expect.objectContaining({
        boundOrgId: ORG_A,
        attemptedOrgId: ORG_B,
        repo: "MembershipRepo",
        operation: "write",
      }),
    );
  });

  it('the metric name is "tenancy.guard.violations" (matches the infra alarm)', () => {
    // Pinned so a rename here without the matching alarm edit is caught.
    expect(TENANCY_GUARD_VIOLATIONS_METRIC).toBe("tenancy.guard.violations");
  });
});

describe("ScopedRepo.stampOrgId — defence-in-depth catch emits the metric", () => {
  beforeEach(() => {
    vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("emits tenancy.guard.violations and throws when a write carries a foreign org_id", () => {
    const repo = new FixtureRepo({} as DbOrTx, ORG_A);
    const foreign = { orgId: ORG_B, role: "owner" };

    expect(() => repo.stamp(foreign)).toThrow(ScopedRepoError);
    expect(metrics.addMetric).toHaveBeenCalledWith(
      TENANCY_GUARD_VIOLATIONS_METRIC,
      MetricUnit.Count,
      1,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "tenancy.guard.violation",
      expect.objectContaining({
        boundOrgId: ORG_A,
        attemptedOrgId: ORG_B,
        // the concrete subclass name is threaded from stampOrgId's `this`
        repo: "FixtureRepo",
      }),
    );
  });

  it("does NOT emit for a legitimate write (no foreign org_id)", () => {
    const repo = new FixtureRepo({} as DbOrTx, ORG_A);
    const values = { role: "owner" };

    expect(repo.stamp(values)).toEqual({ role: "owner", orgId: ORG_A });
    expect(metrics.addMetric).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
