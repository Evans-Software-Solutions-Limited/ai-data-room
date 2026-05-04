# Runbook — GDPR hard-delete

> Support-only path for v0.1. The product does not expose a
> self-serve "delete my account" button — see
> [`requirements.md` §Non-goals](../../.kiro/specs/ai-data-room/auth-and-orgs/requirements.md).

## When this fires

A user makes a GDPR Article 17 ("right to erasure") request via
support. Once support has confirmed the requester's identity and
that the request is in scope (no retention requirement applies),
the deletion is initiated via the WorkOS dashboard. WorkOS handles
its side and fires a `user.deleted` webhook to our system, which
scrubs the local mirror.

## Operator steps

1. **Verify identity.** Stop here if you can't.
2. **Confirm no retention requirement.** If we're under a legal hold
   or the user has been billed in the last 90 days, route to
   finance / legal first.
3. **Open the WorkOS dashboard for the relevant stage** (`dev`,
   `staging`, `production`).
4. **Find the user by email** in WorkOS's User Management view.
5. **Delete the user** from WorkOS. WorkOS handles its side
   (sessions, MFA factors, etc.) and fires the `user.deleted`
   webhook.
6. **Verify the local scrub completed.** In CloudWatch (or the SST
   dev tail), look for the `user_deleted` audit event with the
   user's `workos_user_id` in metadata. If it's missing, see
   troubleshooting below.
7. **Send the user a confirmation email.** This is a manual step
   for v0.1 — we don't auto-send.

## Troubleshooting

### The `user_deleted` audit event didn't appear

- **Check webhook delivery.** WorkOS's webhook console shows
  delivery + retry history. A 4xx response means our handler
  rejected; a 5xx means our infrastructure was down.
- **Check that we mirrored the user.** If the user signed up
  via WorkOS but never made it into our `users` table (rare —
  the signup flow always inserts), the webhook handler audits
  `reason: "user_not_found"` and acks. The WorkOS-side user IS
  deleted; there's just no local row to scrub.
- **Check for redelivery.** If the audit row says
  `reason: "already_deleted"`, the row was scrubbed on a prior
  delivery and this is a redelivery no-op. Safe.

### A row needs a manual scrub

Don't run `UPDATE users SET email = NULL, ...` directly. The
application function `handleUserDeleted` is the only sanctioned
path — it guarantees the audit event fires with the correct
`target_user_id` and enforces the idempotency contract. If WorkOS
is unreachable and the user has a regulator deadline, escalate to
engineering rather than improvising.

## How it works internally

When WorkOS fires the `user.deleted` webhook, the routing layer
calls `handleUserDeleted` in `application/deletion.ts`:

1. Lookup the local mirror by `workos_user_id`.
2. Call `userRepo.scrubPii` — nulls `email` and `full_name`,
   flips `lifecycle_state` to `deleted`, retains
   `workos_user_id` as a tombstone so
   `audit_events.target_user_id` joins still resolve (NFR9).
3. Write a `user_deleted` audit event with `target_user_id` set
   to the local UUID. Metadata deliberately excludes the email
   and name we just scrubbed.

Idempotency: webhook redelivery for an already-scrubbed user is
detected (`lifecycle_state === "deleted"`) and acked without
re-scrubbing. Webhook redelivery for an unmirrored WorkOS user
is also acked without throwing — both audit a failure with the
disambiguating reason.

## Reversibility

There is none. Once `lifecycle_state = 'deleted'` and PII is
nulled, the user cannot log in (the session cookie expires within
the cache TTL, and WorkOS will reject any future authentication
attempt). The audit trail of their activity is preserved, but
their identity is gone.

## Related

- Application function:
  `microservices/core/src/application/deletion.ts`
- Repo method: `userRepo.scrubPii` in
  `microservices/core/src/infrastructure/db/userRepo.ts`
- NFR9 in
  [`requirements.md`](../../.kiro/specs/ai-data-room/auth-and-orgs/requirements.md).
- Integration test proving audit continuity:
  `microservices/core/test/integration/db/auditRepo.integration.test.ts`
  (NFR9 describe block).
