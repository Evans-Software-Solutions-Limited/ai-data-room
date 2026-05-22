# CloudWatch Debugging Runbook

Guide for querying structured logs in CloudWatch Insights. Core
Lambda log groups use JSON format emitted by AWS Lambda Powertools
(wired in slice 1 / T-018).

---

## Log Groups

| Lambda         | Log Group                                 | Service name     | Contains                               |
| -------------- | ----------------------------------------- | ---------------- | -------------------------------------- |
| Core API       | `/aws/lambda/core-api-{stage}`            | `core-api`       | Every protected + public auth route    |
| WorkOS webhook | `/aws/lambda/core-webhook-workos-{stage}` | `workos-webhook` | Webhook ingestion + signature verifier |

---

## Fields Available on Every Log Line

| Field            | Example              | Description                              |
| ---------------- | -------------------- | ---------------------------------------- |
| `level`          | `INFO`, `ERROR`      | Log severity                             |
| `message`        | `request.start`      | Event name                               |
| `service`        | `core-api`           | Lambda service name                      |
| `aws_request_id` | `8f3a2b1c-...`       | Unique per invocation — use to correlate |
| `cold_start`     | `true` / `false`     | Whether this was a cold start            |
| `function_name`  | `core-api-preprod`   | Lambda function name                     |
| `xray_trace_id`  | `1-65f...`           | Cross-link to the X-Ray segment          |
| `method`         | `POST`               | HTTP method (API routes only)            |
| `path`           | `/me`                | HTTP path (API routes only)              |
| `status_code`    | `200`                | Response status (on `request.end`)       |
| `duration_ms`    | `142`                | Request duration (on `request.end`)      |
| `error.name`     | `Error`              | Error class (on errors)                  |
| `error.message`  | `Connection refused` | Error message (on errors)                |
| `error.stack`    | `Error: ...`         | Full stack trace (on errors)             |

---

## Common Queries

### Find all errors in the last hour

```
fields @timestamp, message, error.message, error.stack, path
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

### Trace a single request end-to-end

Use the `aws_request_id` from any log line to find every line from
that invocation:

```
fields @timestamp, level, message, path, status_code, duration_ms
| filter aws_request_id = "YOUR_REQUEST_ID_HERE"
| sort @timestamp asc
```

### Find slow requests (>1 second)

```
fields @timestamp, path, method, duration_ms, aws_request_id
| filter message = "request.end" and duration_ms > 1000
| sort duration_ms desc
| limit 20
```

### Find all 5xx responses

```
fields @timestamp, path, method, status_code, duration_ms, aws_request_id
| filter message = "request.end" and status_code >= 500
| sort @timestamp desc
| limit 50
```

### Show cold starts

```
fields @timestamp, function_name, duration_ms, aws_request_id
| filter cold_start = true
| sort @timestamp desc
| limit 20
```

### Audit-write failures

`safeAudit` swallows the underlying exception to avoid masking the
original outcome — the structured `audit.write_failure` log is the
only operator-visible signal that we lost an audit row. The
`auth.audit.write_failure` metric drives the > 0 alarm.

```
fields @timestamp, message, eventType, outcome, error.message
| filter message = "audit.write_failure"
| sort @timestamp desc
| limit 20
```

### Webhook signature failures

```
fields @timestamp, message, error.message
| filter level = "ERROR" and service = "workos-webhook"
| sort @timestamp desc
| limit 20
```

---

## Metrics

EMF metrics emitted via the `metrics` singleton at
`microservices/core/src/infrastructure/observability/metrics.ts`. All
land in the `AiDataRoom/Auth` namespace.

| Metric                                  | Where it's emitted                                               |
| --------------------------------------- | ---------------------------------------------------------------- |
| `auth.login.success`                    | `getCallbackHandler.ts` happy path                               |
| `auth.login.failure`                    | `getCallbackHandler.ts` 4xx/5xx branches                         |
| `auth.invite.sent`                      | `application/invitations.ts#createInvitation`                    |
| `auth.invite.accepted`                  | `application/invitations.ts#acceptInvitation`                    |
| `auth.invite.expired`                   | `infrastructure/db/invitationRepo.ts#transitionState("expired")` |
| `auth.suspension.applied`               | `application/suspension.ts#suspendUser`                          |
| `auth.suspension.revoked`               | `application/suspension.ts#unsuspendUser`                        |
| `auth.session.validation.latency`       | `requireAuth.ts` (start-to-end timing)                           |
| `auth.webhook.workos.received`          | `handlers/webhooks/workos.ts` route entry                        |
| `auth.webhook.workos.invalid_signature` | `handlers/webhooks/workos.ts` verify failure                     |
| `auth.audit.write_failure`              | `application/_audit-context.ts#safeAudit`                        |

MFA challenge metrics (`auth.mfa.challenge.{success,failure}`) listed
in design.md are not emitted — AuthKit owns the MFA challenge flow
and the WorkOS SDK doesn't surface challenge-level events. They will
land alongside the deferred MFA-failure alarm.

---

## Alarms

Wired in `infra/observability.ts`. Targets land in the
`ai-data-room-{stage}-alarms` SNS topic; subscriptions are configured
per-stage in the console for v0.1.

| Alarm                            | Metric                                  | Threshold         |
| -------------------------------- | --------------------------------------- | ----------------- |
| Failed login spike               | `auth.login.failure`                    | Anomaly band (3×) |
| WorkOS webhook invalid signature | `auth.webhook.workos.invalid_signature` | > 0 over 5 min    |
| Session validation p95 latency   | `auth.session.validation.latency` (p95) | > 500ms × 15 min  |
| Audit event write failures       | `auth.audit.write_failure`              | > 0 over 5 min    |

---

## How to Access

1. Open **AWS Console → CloudWatch → Logs → Logs Insights**
2. Select the relevant log group(s) from the dropdown
3. Set the time range (top right)
4. Paste a query and click **Run query**

You can select multiple log groups to search across both Lambdas
simultaneously.

For X-Ray traces: **AWS Console → X-Ray → Traces**. Filter by
annotation (`userId = "..."`, `orgId = "..."`, `eventType = "..."`)
to scope to a single user / org / webhook event type.

---

## Tips

- **Start broad, then narrow.** Begin with all errors, then filter
  by path or service.
- **Use `aws_request_id` to correlate.** Every line in a single
  invocation shares this ID.
- **Cross-link to X-Ray:** every log line carries `xray_trace_id` —
  paste it into the X-Ray console to see the full segment tree.
- **Stats queries:** `stats count(*) by path` or
  `stats avg(duration_ms) by path` for aggregate views.
- **Export results:** Click "Export results" → CSV for sharing.
