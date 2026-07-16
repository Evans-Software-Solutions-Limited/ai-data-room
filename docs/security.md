# Security — auth-and-orgs slice

Maps every non-functional requirement (NFR) from
[`auth-and-orgs/requirements.md`](../.kiro/specs/ai-data-room/auth-and-orgs/requirements.md)
to its implementation site and the test that proves it. Spec source:
slice 1 design / requirements docs. Test source:
[`microservices/core/src/security/__tests__/nfr-matrix.test.ts`](../microservices/core/src/security/__tests__/nfr-matrix.test.ts).

The matrix test is the operational tripwire — every NFR has at least
one assertion, and any drift that violates a row trips its test
before merge.

---

## NFR matrix

| NFR       | Requirement (summary)                                                     | Implementation                                                                                                                                                                                                                                                                                                                                                     | Verification                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NFR1**  | Authenticated endpoints return 401 on unauth                              | `application/auth/guards/requireAuth.ts` resolves every protected route via `.resolve(requireAuth)` in `protectedRoutes.ts` (two sub-bundles: `meRoutes` + `orgScopedRoutes`)                                                                                                                                                                                      | Behavioural: `protectedRoutes.test.ts` (401 paths). Structural: matrix NFR1 grep asserts both sub-bundles are gated.                                                                             |
| **NFR2**  | Passwords hashed via KDF, never stored/logged/transmitted by us           | Delegated entirely to WorkOS AuthKit. Our codebase never declares a `password` field on any storage / domain type. See [NFR2-note](#nfr2-note) for the two SDK-boundary exceptions.                                                                                                                                                                                | Matrix NFR2 grep across `microservices/**` + `packages/**` for `password: (z.\|string)`, excluding the SDK-boundary paths.                                                                       |
| **NFR3**  | TLS-only ingress                                                          | API Gateway HTTP API v2 is HTTPS-by-default (SST `sst.aws.ApiGatewayV2`). No HTTP listener exists to disable.                                                                                                                                                                                                                                                      | Matrix NFR3 grep across `infra/**` for non-`localhost` `http://` URLs.                                                                                                                           |
| **NFR4**  | Per-IP login rate-limit: 10/IP/min + 5/email/min                          | **Per-IP:** `middleware/rateLimit.ts` (Elysia plugin, applied to `publicRoutes`, in-memory LRU). **Per-email:** delegated to AuthKit — we never see the target email until AuthKit has validated the code. **Stage-level throttle:** `infra/api.ts` `defaultRouteSettings` (100 req/sec sustained, 200 burst) as the outer DDoS envelope.                          | Matrix NFR4: limit constant matches spec; plugin actually returns 429 after the cap. Behavioural: `rateLimit.test.ts` (9 scenarios).                                                             |
| **NFR5**  | Invite / verification / reset tokens use 128-bit unguessable + single-use | Token issuance delegated to WorkOS (`workos.sendInvitation`, `workos.createPasswordReset`). Single-use enforced at SQL via `InvitationRepo.transitionState(id, expectedState, newState)` — compare-and-set WHERE clause prevents a second transition.                                                                                                              | Matrix NFR5: no homegrown `generateToken` call sites; `transitionState` has the expected-state WHERE clause. Integration: `invitationRepo.integration.test.ts` proves the TOCTOU race is closed. |
| **NFR6**  | MFA TOTP seeds + recovery codes encrypted at rest                         | **Not stored by us at all** (ADR-003). AuthKit owns the entire recovery-codes UX. No `recovery_codes` column, no plaintext storage anywhere in our schema.                                                                                                                                                                                                         | Matrix NFR6 grep across `microservices/**` + `packages/**` for `recovery_codes` field declarations.                                                                                              |
| **NFR7**  | Session cookies are `HttpOnly` + `Secure` + `SameSite=Lax` (or stricter)  | Centralised in `application/auth/config/frontendUrl.ts#setSecureCookie` — every cookie set by the API goes through this helper. The four invariant attributes (`HttpOnly`, `Secure`, `SameSite=Lax`, `path=/`) are baked in. `Secure` is gated on `isSecureOrigin` (false only when `SST_DEV=true`, since browsers reject `Secure` cookies on `http://localhost`). | Matrix NFR7: source-level assertion that the four attributes are set + that `isSecureOrigin` is `true` outside dev.                                                                              |
| **NFR8**  | Logs exclude passwords, MFA/recovery codes, session/reset/invite tokens   | Two layers: (1) `application/audit.ts#recordAuditEvent` validates audit metadata against a Zod schema that rejects forbidden material; (2) the matrix grep catches direct `logger.* / console.*` calls that bypass the validator.                                                                                                                                  | Matrix NFR8 grep: forbidden field names in any `(logger\|console).<level>(...)` call across the codebase. Application-layer test: `audit.test.ts` covers the validator strip path.               |
| **NFR9**  | GDPR hard-delete supported without breaking audit continuity              | `application/deletion.ts#handleUserDeleted` scrubs PII (email, fullName) but preserves `workos_user_id` + `audit_events.target_user_id` references. `lifecycle_state` flips to `deleted` so the row is filterable. T-019.                                                                                                                                          | Matrix NFR9: source-level assertion the deletion flow uses PII-scrub + lifecycle flip, never `DELETE FROM users`. Integration: `deletion.test.ts` proves audit joins still resolve post-delete.  |
| **NFR10** | Audit log immutability is feasible (SOC 2 / ISO 27001 future scope)       | Application layer never calls `auditRepo.update` or `auditRepo.delete` — every audit write goes through the `recordAuditEvent` append-only path. No DML on `audit_events` in any production code path.                                                                                                                                                             | Matrix NFR10 grep across `microservices/**` for `auditRepo.{update,delete,patch,truncate}` calls.                                                                                                |
| **NFR11** | Metrics for anomalous auth patterns                                       | Powertools metrics from T-018 (`auth.login.failure`, `auth.webhook.workos.invalid_signature`, `auth.session.validation.latency`, `auth.audit.write_failure`, plus rate-limit `auth.rate_limit.auth.blocked` from T-020). Four CloudWatch alarms in `infra/observability.ts`.                                                                                       | Matrix NFR11: source-level assertion the four alarm declarations exist. Behavioural: per-flow tests assert each metric name lands at its call site.                                              |

<a id="nfr2-note"></a>

**NFR2 SDK-boundary exceptions.** Two paths legitimately type a
`password` field because the WorkOS SDK requires one:

- `microservices/core/src/infrastructure/workos/client.ts` declares
  the `authenticateWithPassword` payload type. Pure type — the value
  is forwarded directly to the SDK and never persisted, logged, or
  echoed back.
- `microservices/core/src/application/auth/e2e-bootstrap/postE2EAuthLoginHandler.ts`
  passes the inbound `body.password` straight to the wrapper.
  Gated by `isProduction → 404` + `E2E_AUTH_SECRET → 503/401` so
  production traffic never reaches the SDK call path.

The NFR2 grep excludes both paths so they don't trip the matrix
test; any new file containing a `password: string` field declaration
will still trip it.

---

## Threat model — what's covered, what's deferred

### Covered

- **Bot login probes.** Per-IP rate-limit at the Elysia layer caps each
  IP at 10 attempts/minute on the public auth surface. Stage-level
  throttle bounds the worst-case Lambda concurrency at 200 req/sec.
- **Session hijacking via XSS / network sniff.** `HttpOnly` blocks
  JS access to the cookie; `Secure` blocks plaintext-network exposure;
  `SameSite=Lax` blocks CSRF-style cross-site cookie attachment on
  cross-site `POST`/state-changing methods.
- **Replay of revoked invites / reset links.** Single-use enforced
  via compare-and-set at the SQL layer; concurrent attempts to
  consume the same token race-and-lose deterministically.
- **Webhook spoofing.** WorkOS signature verification at
  `infrastructure/workos/webhook.ts` — invalid signatures return 401
  and increment `auth.webhook.workos.invalid_signature` (alarmed at
  `> 0` over 5 min).
- **Audit-write loss.** `safeAudit` catches the underlying error so
  it can't mask the original outcome, then emits
  `auth.audit.write_failure` + a structured error log. Alarm fires
  on `> 0` across both Lambda services (per-Lambda dimension SUM via
  `metricQueries` with `FILL(..., 0)` — see `infra/observability.ts`
  for the metric-math nuance).
- **Cross-org tenant escalation.** Handler-layer `authorizeOrgAccess`
  gate (cross-org check + role allowlist) plus application-layer
  defence-in-depth (`invitation.orgId === input.orgId` mismatch
  treated as not-found).

### Deferred (Phase 2)

- **WAF / per-IP rate limit at the edge.** HTTP API v2 doesn't
  natively accept AWS WAF — WAF only attaches to REST API, ALB,
  CloudFront, AppSync. The CloudFront-in-front-of-the-API +
  WAF combination lands when the web app gets its real domain.
- **Distributed rate-limit state.** In-memory per-Lambda store means
  effective per-IP cap is `LIMIT × N_concurrent_instances`. Acceptable
  for v0.1 traffic (single tenant, tens of users); DynamoDB or
  ElastiCache backing is Phase 2.
- **MFA challenge metrics + alarm.** AuthKit owns the challenge flow
  and the v8.13 WorkOS SDK doesn't surface challenge-level events.
  Deferred alongside the WorkOS event-name investigation tracked in
  the archived slice-1 handoff
  (`docs/archive/2026-05-31-handoff-auth-and-orgs.md`).
- **PII redaction in non-audit logs.** `recordAuditEvent` strips
  forbidden material from audit metadata, and the matrix grep catches
  direct log-call regressions, but there's no centralised redactor.
  Most call sites use structured logging with explicit field names,
  so the grep is high-precision; a Pino-style serializer is Phase 2
  if a slip ever lands.

---

## Operating procedure

### When a new auth flow ships

1. Add the metric emit site (T-018 conventions —
   [`docs/runbooks/cloudwatch-debugging.md`](runbooks/cloudwatch-debugging.md)).
2. Add the per-flow test assertion that the metric lands.
3. If the flow adds a new cookie, route the set through `setSecureCookie`.
4. If the flow accepts a new external token, route validation through
   the existing WorkOS wrappers — don't hand-roll.
5. Re-read this doc's matrix; add a new NFR row if the flow opens a
   new threat surface.

### When the matrix test fails

The failing `it()` block names the NFR. The body usually contains a
one-line description of the violation. Most failures are either:

- **A new file slipped a forbidden pattern** (NFR2 / NFR8 / NFR10 /
  NFR6). The grep output names the offending file — fix or justify.
- **A guard structure changed** (NFR1 / NFR5 / NFR7). The source-grep
  is a structural invariant; if the structure changed intentionally,
  update both the matrix test and this doc.
- **The rate-limit constant drifted** (NFR4). The spec is 10/IP/min;
  changing the constant requires updating the spec first.

### When an NFR changes

Order: requirements.md → security.md (this file) → matrix test → impl.
The matrix test should fail until the impl catches up.
