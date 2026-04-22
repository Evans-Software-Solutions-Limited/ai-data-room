# @ai-data-room/workers

Async workers. **Stub at v0.1** — only a healthz route. Wired in when slice 5 (`ai-doc-sensecheck`) reaches task phase.

## Expected tenants (incoming slices)

- **Sense-check SQS consumer** (slice 5, T-007): consumes `document.uploaded` events, runs Claude Haiku 4.5 classification against slot criteria, writes verdict rows.
- **Billing reconciliation job** (slice 8, T-012): daily recompute vs. Stripe, drift alerts.
- **Activation metrics listener** (slice 9, T-006): subscribes to `invitation.created` + `slot.ai_checked`, persists activation timestamps.
- **Audit retention / PII scrub** (post-MVP, SOC 2): trigger-enforced append-only + scheduled tombstone scrubs.

## Structure

Follows the same layered convention as `microservices/core/src`: `domain` / `application` / `infrastructure` / `handlers`. Handlers in workers are SQS / EventBridge / scheduler entry points, not HTTP.
