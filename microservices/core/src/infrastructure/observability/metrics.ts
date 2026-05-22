import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";

// Per design.md §Observability each auth-flow outcome is its own
// metric name (`auth.login.success` vs `auth.login.failure`), so
// `addDimensions` is deliberately never called — keeps alarm queries
// trivial and removes the cross-request dimension-leak surface on
// warm Lambdas.
export const metrics = new Metrics();

export function emitCount(name: string, value: number = 1): void {
  metrics.addMetric(name, MetricUnit.Count, value);
}

export function emitLatency(name: string, durationMs: number): void {
  metrics.addMetric(name, MetricUnit.Milliseconds, durationMs);
}

// Call once per invocation. Powertools' `publishStoredMetrics`
// coalesces every metric added during the request into a single EMF
// log line, then clears the internal buffer so consecutive warm
// invocations don't double-emit.
export function flushMetrics(): void {
  metrics.publishStoredMetrics();
}
