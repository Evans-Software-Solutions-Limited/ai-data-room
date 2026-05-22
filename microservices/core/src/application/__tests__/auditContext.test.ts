// Unit tests for `safeAudit` — the wrapper every auth flow uses
// around `recordAuditEvent` so a failed audit write can't mask the
// original outcome. The fault-path emits `auth.audit.write_failure`
// (the only operator-visible signal, per the `> 0` alarm) and a
// structured error log.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricUnit } from "@aws-lambda-powertools/metrics";

import { metrics } from "../../infrastructure/observability/metrics";
import { logger } from "../../infrastructure/logging/logger";
import { safeAudit } from "../_audit-context";
import type { AuditRepo } from "../../infrastructure/db/auditRepo";

function makeAuditRepo(
  write: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
): AuditRepo {
  return { write } as unknown as AuditRepo;
}

const EVENT = {
  eventType: "login_success" as const,
  outcome: "success" as const,
  actorUserId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  sourceIp: "203.0.113.5",
  userAgent: "test/1.0",
  metadata: {},
};

describe("safeAudit", () => {
  beforeEach(() => {
    vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not emit the failure metric on a successful audit write", async () => {
    const auditRepo = makeAuditRepo();
    await safeAudit({ auditRepo }, EVENT);

    expect(auditRepo.write).toHaveBeenCalledTimes(1);
    expect(metrics.addMetric).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("emits auth.audit.write_failure + a structured error log when the write throws", async () => {
    const auditRepo = makeAuditRepo(
      vi.fn().mockRejectedValue(new Error("planetscale unreachable")),
    );

    await safeAudit({ auditRepo }, EVENT);

    // The catch swallows so the caller's happy path isn't masked,
    // but the metric + log are the operator-visible signals.
    expect(metrics.addMetric).toHaveBeenCalledWith(
      "auth.audit.write_failure",
      MetricUnit.Count,
      1,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "audit.write_failure",
      expect.objectContaining({
        eventType: "login_success",
        outcome: "success",
        error: expect.objectContaining({
          name: "Error",
          message: "planetscale unreachable",
        }),
      }),
    );
  });

  it("does not re-throw — the original auth flow must continue", async () => {
    const auditRepo = makeAuditRepo(
      vi.fn().mockRejectedValue(new Error("boom")),
    );
    await expect(safeAudit({ auditRepo }, EVENT)).resolves.toBeUndefined();
  });
});
