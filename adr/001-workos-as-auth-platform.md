# ADR-001 — WorkOS as the auth platform for ai-data-room

- **Status:** accepted
- **Date:** 2026-04-22
- **Deciders:** Bradley Simms-Evans (Owner / CTO)
- **Related:** `specs/ai-data-room/auth-and-orgs/{requirements,design}.md`,
  `memory/tech-stack.md`, `memory/projects.md` (`funds-distribution-platform`
  reference), ADR-002 (Postgres for auth domain)

## Context

`ai-data-room` is a secure, AI-native document room that external
counterparties use to review sensitive company material (financials,
cap tables, contracts). The auth posture therefore has to be materially
stronger than a generic SaaS — specifically:

1. **MFA mandatory for every human user**, including external viewers,
   because a compromised external account leaks customer material.
2. **Credential hygiene done properly** — password reset, email
   verification, rate-limited brute-force defence, session revocation
   on suspension — without us reinventing the wheel.
3. **A structured audit trail of auth events** (logins, MFA challenges,
   invitations, password resets) queryable per-org — a precondition for
   the SOC 2 track we'll pick up once the MVP is in customer hands.
4. **SSO/SAML** in roadmap reach — enterprise customers (the eventual
   buyer persona for Growth tier) require it, and retrofitting SSO onto
   a roll-our-own system is painful.
5. **Fast time-to-first-customer**. Bradley is one engineer + Claude
   Code agents; he cannot afford to spend two weeks reinventing auth
   when the differentiator is the AI + UX layer on top of the room.

Auth is also the **foundation slice** — everything else
(`room-and-folders`, `access-control`, `billing`, …) presumes identity,
orgs, and role enforcement are solved. Getting it wrong forces
redesign across all nine slices.

Bradley's existing production stack (`funds-distribution-platform` at
Capital Pay) already runs `@workos-inc/node@^8.5.0` in anger with a
layered architecture, WorkOS webhook signature verification, and the
same SST v4 deployment target. That pattern transfers cleanly.

## Decision

Use **WorkOS** — specifically **AuthKit** (hosted login / signup / MFA
enrolment UI) plus the **User Management API** — as the identity
substrate for `ai-data-room`.

Concretely:

- Identity, email verification, MFA enrolment + TOTP verification,
  password reset, session token issuance, and invitation token issuance
  are all delegated to WorkOS.
- We own the domain model that sits **above** WorkOS: `organizations`,
  `org_memberships`, `external_access_grants`, `invitations` (our side
  of the 1:1 mirror), `users` (mirror of WorkOS users for FK joins),
  and `audit_events` (our product-level audit trail, separate from
  WorkOS's own audit log).
- Session validation goes through a middleware that calls the WorkOS
  SDK, fronted by a 60s in-memory LRU cache per pod to keep p50 API
  latency acceptable. Explicit cache-bust on suspension so the 1-minute
  session-termination SLA (FR21) holds.
- WorkOS webhooks are the **source of truth** for lifecycle events
  (user created / updated / deleted, MFA enrolled, session revoked).
  Webhook handler verifies the WorkOS signature before mutating state.
- All WorkOS secrets (API key, webhook signing secret, cookie signing
  key) live in AWS Secrets Manager, referenced via `new sst.Secret()`
  following the FDP pattern.

The integration pattern will mirror `funds-distribution-platform`:
layered domain/application/infrastructure/handlers with WorkOS calls
isolated in `infrastructure/workos/*.ts` and typed DTOs crossing the
boundary.

## Alternatives considered

### Option A — WorkOS (AuthKit + User Management) ✅ chosen

- ✅ Batteries-included MFA, email verification, password reset, invite
  tokens, SSO/SAML-ready. None of these need to be built.
- ✅ Pattern already in production at Capital Pay (FDP) with Bradley's
  own code — zero learning curve, zero new ops surface.
- ✅ Compliance-adjacent: WorkOS itself is SOC 2 Type II, which shortens
  our eventual SOC 2 scope.
- ❌ Per-MAU pricing. Starter tier is generous but the curve bends at
  scale; mitigated by the fact that most of our MAU are internal
  teammates + external viewers with short scope, not heavy users.
- ❌ Vendor lock-in. Mitigated by keeping our domain model and audit
  trail entirely in our Postgres; WorkOS could be swapped for Clerk or
  a roll-your-own Lucia stack in a future ADR-supersede without data
  loss.

### Option B — Auth0 / Okta Customer Identity

- ✅ Oldest, most-hardened option; strongest enterprise SSO story.
- ❌ Developer experience is weaker than WorkOS for a TypeScript-first
  stack; rules / actions ecosystem is legacy-flavoured.
- ❌ Pricing curve steeper at our scale than WorkOS.
- ❌ No existing Bradley precedent, so we'd be paying the first-use tax.

### Option C — Clerk

- ✅ Excellent DX, React-first, generous free tier.
- ❌ Less mature on the "multi-tenant org + external-scope" model that
  ai-data-room fundamentally needs. Orgs are recent; external-grant
  style scoping would need a lot of custom glue.
- ❌ Not present in Bradley's stack, so we'd be introducing a new
  vendor without the FDP-pattern dividend.

### Option D — Roll our own (Lucia / Auth.js + custom MFA + custom SMTP)

- ✅ Zero vendor cost, full control, no lock-in.
- ❌ Time-to-first-customer blows up. Writing credible MFA + rate
  limiting + recovery codes + webhook-level audit + signed-cookie
  sessions is weeks of work I cannot afford to repeat across
  side-projects.
- ❌ SOC 2 track becomes materially harder — auth is where audit
  evidence is scrutinised hardest.
- ❌ Bradley's stated "production-ready SaaS as a revenue stream"
  objective is incompatible with "auth is a side quest".

### Option E — AWS Cognito

- ✅ Native to the AWS SST stack; IAM integration is cheap.
- ❌ UX on hosted flows is dated; MFA enrolment UX in particular is
  a common support-ticket driver.
- ❌ Org / tenancy model is weaker than WorkOS Organizations.
- ❌ No Bradley precedent; no FDP-pattern dividend.

### Option F — Supabase Auth

- ✅ Fast to integrate if we were on Supabase.
- ❌ We're on SST v4 + PlanetScale Postgres, not Supabase. Adopting
  Supabase Auth pulls us toward Supabase for everything or leaves us
  with an awkward split-brain.

## Consequences

### Positive

- **Foundation slice ships in weeks not months.** `auth-and-orgs` tasks
  collapse from "build MFA" to "wire WorkOS + build our domain layer".
- **Day-1 SOC 2 readiness** on the identity surface: WorkOS provides
  the hardest audit evidence for free (login audit, MFA enforcement,
  webhook verification on their side).
- **Reuses the FDP pattern** — I can have Claude Code agents cross-read
  the FDP repo for conventions when executing task-phase PRs.
- **Enterprise SSO unlock later is a config change**, not a rebuild.
- **Own our domain model** keeps lock-in minimal — org concept,
  role assignment, Opportunity scope, audit events are all ours. If we
  ever swap WorkOS out, we remap `workos_*_id` columns but keep the
  domain intact.

### Negative

- **Vendor cost scales with MAU.** Mitigation: monitor `auth.*` metrics
  and re-evaluate on the quarter where WorkOS cost exceeds 2% of MRR
  (SaaS rule-of-thumb). Re-evaluation is an ADR-supersede, not a
  rebuild, because our data model is portable.
- **Dual-write risk** between WorkOS and our `users` table. Mitigation:
  WorkOS webhooks are the source of truth; nightly reconciliation job
  compares WorkOS user list vs. our mirror and logs drift as a metric.
- **Session validation adds ~60–100ms** if uncached. Mitigated by the
  60s LRU cache with explicit bust on suspension.
- **WorkOS downtime propagates to login availability.** Mitigation:
  status-page monitoring alert; existing sessions continue to work
  (cached for 60s, cookie remains valid until WorkOS session revoked).

### Follow-ups / work items

- Track `auth.*` metrics from day one (already specified in
  `auth-and-orgs/design.md §Observability`).
- Add nightly WorkOS ↔ `users` reconciliation job — will live as a
  small scheduled task post-MVP; capture as Phase-2 backlog item.
- When SOC 2 scope begins, revisit `audit_events` immutability —
  currently append-only-by-convention, needs a trigger-enforced guard.
- Field-encrypt `users.email` and `users.full_name` when SOC 2 scope
  begins (noted in `memory/decisions.md`).
- When we hit the first prospect with a SAML requirement, promote
  SSO configuration from "available" to "exercised" — add a new slice
  `enterprise-sso` rather than retrofitting into `auth-and-orgs`.
- Budget review: set a $ threshold in the billing dashboard for when
  WorkOS cost warrants the supersede review.

## References

- Spec: `specs/ai-data-room/auth-and-orgs/design.md` §Boundary table
  and §Security.
- Precedent: `funds-distribution-platform` — `@workos-inc/node@^8.5.0`
  in production, layered WorkOS integration pattern.
- WorkOS docs: <https://workos.com/docs/user-management>
- WorkOS AuthKit: <https://workos.com/docs/user-management/authkit>
- WorkOS SOC 2 posture: <https://workos.com/trust>
