// CloudWatch alarms for slice 1 (auth-and-orgs) observability, per
// `auth-and-orgs/design.md` §Observability.
//
// Five alerts are spec'd. Four are wired here against the metrics
// emitted by `microservices/core/src/infrastructure/observability/
// metrics.ts`. The fifth — "MFA failure spike" — is deferred because
// AuthKit owns the MFA challenge flow and the WorkOS SDK doesn't
// surface challenge-level events (see HANDOFF sticky #32). It'll
// land alongside whatever event-name investigation closes that gap.
//
// Alarm targets land in a single SNS topic stub; subscriptions
// (PagerDuty, email, Slack) are configured per-stage in the console
// for v0.1 — wiring the subscription here would require per-stage
// secret rotation that's not worth the infra surface for one slice.
// `alarmsTopic.arn` is exported so a future `infra/alerts.ts` can
// attach subscriptions declaratively without re-importing the topic.
//
// The metric namespace must match `POWERTOOLS_METRICS_NAMESPACE` in
// `infra/api.ts`. The dimension `service` is auto-added by
// Powertools from `POWERTOOLS_SERVICE_NAME`; we filter on it so
// alarms only fire for the relevant Lambda.

const METRICS_NAMESPACE = "AiDataRoom/Auth";
const ALARM_PREFIX = `ai-data-room-${$app.stage}`;

export const alarmsTopic = new aws.sns.Topic("alarms-topic", {
  name: `${ALARM_PREFIX}-alarms`,
});

interface AlarmDefaults {
  alarmDescription: string;
  namespace: string;
  alarmActions: string[];
  okActions: string[];
  treatMissingData: "notBreaching";
}

const sharedDefaults = (description: string): AlarmDefaults => ({
  alarmDescription: description,
  namespace: METRICS_NAMESPACE,
  alarmActions: [alarmsTopic.arn],
  okActions: [alarmsTopic.arn],
  // No data = no problem. Auth flows are bursty (login spike at
  // 09:00, quiet at 03:00) and "no metric in window" should not
  // page anyone.
  treatMissingData: "notBreaching",
});

// 1. Failed-login spike. The design.md rule is ">3× 1-week baseline";
// CloudWatch can't compute that as a static threshold, so we
// approximate with anomaly detection (band 3 = ~3× the rolling
// envelope) over a 5-minute window. Failed-login authentic-but-wrong
// is the early signal we care about; brute-force shows up as a
// sustained spike here.
new aws.cloudwatch.MetricAlarm("alarm-failed-login-spike", {
  name: `${ALARM_PREFIX}-failed-login-spike`,
  ...sharedDefaults("Failed login attempts spiking — possible brute force"),
  comparisonOperator: "GreaterThanUpperThreshold",
  evaluationPeriods: 1,
  thresholdMetricId: "ad1",
  metricQueries: [
    {
      id: "m1",
      metricStat: {
        metric: {
          metricName: "auth.login.failure",
          namespace: METRICS_NAMESPACE,
          dimensions: { service: "core-api" },
        },
        period: 300,
        stat: "Sum",
      },
      returnData: true,
    },
    {
      id: "ad1",
      expression: "ANOMALY_DETECTION_BAND(m1, 3)",
      label: "auth.login.failure (expected)",
      returnData: true,
    },
  ],
});

// 2. Invalid webhook signatures > 0. A single invalid signature is a
// signal — either the webhook secret has rotated and we missed it,
// or someone is probing the endpoint with spoofed headers. Either
// case warrants an immediate look.
new aws.cloudwatch.MetricAlarm("alarm-webhook-invalid-signature", {
  name: `${ALARM_PREFIX}-webhook-invalid-signature`,
  ...sharedDefaults("WorkOS webhook signature failure — secret out of sync?"),
  metricName: "auth.webhook.workos.invalid_signature",
  dimensions: { service: "workos-webhook" },
  statistic: "Sum",
  period: 300,
  evaluationPeriods: 1,
  threshold: 0,
  comparisonOperator: "GreaterThanThreshold",
});

// 3. Session validation p95 > 500ms sustained. The session refresh
// path is the slowest branch (a network round-trip to WorkOS), so
// p95 spikes here usually mean WorkOS-side latency.
new aws.cloudwatch.MetricAlarm("alarm-session-validation-p95", {
  name: `${ALARM_PREFIX}-session-validation-p95`,
  ...sharedDefaults("Session validation p95 > 500ms — WorkOS or JWKS slow?"),
  metricName: "auth.session.validation.latency",
  dimensions: { service: "core-api" },
  extendedStatistic: "p95",
  period: 300,
  evaluationPeriods: 3, // 3 × 5min = 15 minutes sustained
  threshold: 500,
  comparisonOperator: "GreaterThanThreshold",
});

// 4. Audit event write failures > 0. The audit table is the
// compliance backbone; a dropped write is a serious gap. `safeAudit`
// swallows the exception to avoid masking the original outcome, so
// this metric is the only operator-visible signal that we lost a row.
//
// `safeAudit` runs in both Lambdas — the core API (`service:
// "core-api"`) for online auth flows, and the webhook handler
// (`service: "workos-webhook"`) for `user.deleted`,
// `password_reset.succeeded`, and `invitation.accepted` flows.
// Powertools tags each emission with the source Lambda's service,
// so the alarm has to aggregate across BOTH services or it silently
// misses webhook-side failures (Inspector Brad finding #1).
new aws.cloudwatch.MetricAlarm("alarm-audit-write-failure", {
  name: `${ALARM_PREFIX}-audit-write-failure`,
  ...sharedDefaults("Audit event write failed — compliance gap, investigate"),
  evaluationPeriods: 1,
  threshold: 0,
  comparisonOperator: "GreaterThanThreshold",
  metricQueries: [
    {
      id: "core",
      metricStat: {
        metric: {
          metricName: "auth.audit.write_failure",
          namespace: METRICS_NAMESPACE,
          dimensions: { service: "core-api" },
        },
        period: 300,
        stat: "Sum",
      },
      returnData: false,
    },
    {
      id: "webhook",
      metricStat: {
        metric: {
          metricName: "auth.audit.write_failure",
          namespace: METRICS_NAMESPACE,
          dimensions: { service: "workos-webhook" },
        },
        period: 300,
        stat: "Sum",
      },
      returnData: false,
    },
    {
      id: "total",
      expression: "core + webhook",
      label: "auth.audit.write_failure (all services)",
      returnData: true,
    },
  ],
});

// 5. MFA failure spike — DEFERRED. AuthKit owns the challenge flow
// and the v8.13 WorkOS SDK doesn't surface challenge-level events,
// so we can't emit the `auth.mfa.challenge.failure` metric that
// would drive this alarm. Land alongside the WorkOS event-name
// investigation tracked in HANDOFF follow-ups.
