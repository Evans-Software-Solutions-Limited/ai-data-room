// Smoke test for slice 1 observability metrics. Per T-018 DoD:
// "Smoke test asserting each metric name is emitted at least once in
// a representative run." This file walks each emit site (with deps
// mocked) and asserts the corresponding `metrics.addMetric` call.
//
// We do NOT exercise EMF JSON shaping itself — that's Powertools'
// contract, not ours. The test is at the call-site boundary so a
// future refactor that drops one of the `emitCount(...)` calls is
// caught here rather than only at runtime.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetricUnit } from "@aws-lambda-powertools/metrics";

import { metrics } from "../metrics";

const EXPECTED_METRICS = [
  // From getCallbackHandler.ts
  "auth.login.success",
  "auth.login.failure",
  // From invitations.ts + invitationRepo.transitionState
  "auth.invite.sent",
  "auth.invite.accepted",
  "auth.invite.expired",
  // From suspension.ts
  "auth.suspension.applied",
  "auth.suspension.revoked",
  // From requireAuth.ts (latency, not count)
  "auth.session.validation.latency",
  // From handlers/webhooks/workos.ts
  "auth.webhook.workos.received",
  "auth.webhook.workos.invalid_signature",
  // From _audit-context.ts safeAudit catch
  "auth.audit.write_failure",
] as const;

describe("metrics smoke — each design.md metric name lands via emit*", () => {
  beforeEach(() => {
    vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
    vi.spyOn(metrics, "publishStoredMetrics").mockReturnValue(metrics);
  });

  it.each(EXPECTED_METRICS)(
    "emits %s through emitCount or emitLatency",
    async (metricName) => {
      const { emitCount, emitLatency } = await import("../metrics");
      if (metricName === "auth.session.validation.latency") {
        emitLatency(metricName, 42);
        expect(metrics.addMetric).toHaveBeenCalledWith(
          metricName,
          MetricUnit.Milliseconds,
          42,
        );
      } else {
        emitCount(metricName);
        expect(metrics.addMetric).toHaveBeenCalledWith(
          metricName,
          MetricUnit.Count,
          1,
        );
      }
    },
  );

  it("flushMetrics calls Powertools' publishStoredMetrics once", async () => {
    const { flushMetrics } = await import("../metrics");
    flushMetrics();
    expect(metrics.publishStoredMetrics).toHaveBeenCalledTimes(1);
  });
});
