// Unit tests for the metric-emission wrappers. The "each metric
// name is emitted at least once in a representative run" smoke from
// T-018's DoD is asserted inside the existing per-flow tests
// (publicRoutes / invitations / suspension / requireAuth / workos
// webhook router / auditContext / invitationRepo) — those exercise
// the real call sites with mocked deps, so a deleted `emitCount(...)`
// inside a handler trips its own test rather than relying on this
// file to walk every site by hand.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MetricUnit } from "@aws-lambda-powertools/metrics";

import { emitCount, emitLatency, flushMetrics, metrics } from "../metrics";

describe("metric wrappers", () => {
  beforeEach(() => {
    vi.spyOn(metrics, "addMetric").mockReturnValue(metrics);
    vi.spyOn(metrics, "publishStoredMetrics").mockReturnValue(metrics);
  });

  it("emitCount forwards the name + Count unit with default value 1", () => {
    emitCount("auth.example.count");
    expect(metrics.addMetric).toHaveBeenCalledWith(
      "auth.example.count",
      MetricUnit.Count,
      1,
    );
  });

  it("emitCount accepts an explicit value override", () => {
    emitCount("auth.example.count", 7);
    expect(metrics.addMetric).toHaveBeenCalledWith(
      "auth.example.count",
      MetricUnit.Count,
      7,
    );
  });

  it("emitLatency forwards the name + Milliseconds unit", () => {
    emitLatency("auth.example.latency", 42);
    expect(metrics.addMetric).toHaveBeenCalledWith(
      "auth.example.latency",
      MetricUnit.Milliseconds,
      42,
    );
  });

  it("flushMetrics delegates to Powertools' publishStoredMetrics", () => {
    flushMetrics();
    expect(metrics.publishStoredMetrics).toHaveBeenCalledTimes(1);
  });
});
