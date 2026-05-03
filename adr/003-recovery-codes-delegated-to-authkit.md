# ADR-003 — Recovery-codes UX delegated to AuthKit (we never see plaintext)

- **Status:** accepted
- **Date:** 2026-05-03
- **Deciders:** Bradley Simms-Evans (Owner / CTO)
- **Related:** `specs/ai-data-room/auth-and-orgs/{requirements.md,design.md,tasks.md}`,
  ADR-001 (WorkOS as auth platform)

## Context

`requirements.md` FR17 says the user must be able to view AND download
their MFA recovery codes "at the moment of enrolment".

`design.md` §`recovery_codes` says the opposite about implementation:
"WorkOS holds MFA secrets and recovery codes... we never see plaintext
codes."

`tasks.md` T-010 then said "expose a `getRecoveryCodesForDownload`
application method that... returns the codes text-file payload" — a
literal third position that contradicted the design.

While picking T-010 up for implementation we hit the contradiction.
Three internally-consistent paths exist; the spec needed a single one.

## Decision

**Delegate the entire recovery-codes UX to WorkOS AuthKit.** Plaintext
codes never enter our system, our DB, our logs, our audit metadata, or
our application code. We do not implement
`getRecoveryCodesForDownload`; we do not store or proxy codes; the
"view + download" behaviour required by FR17(a) and FR17(b) is
delivered by AuthKit's hosted enrolment UI, which is the screen the
user sees during the enrolment redirect.

Our application layer for T-010 is therefore reduced to:

- `handleMfaEnrolled` — `authentication.mfa_enrolled` webhook fires;
  we mirror `users.mfa_enrolled_at` and audit `mfa_enrolled`.
- `handleRecoveryCodeUsed` — `authentication.recovery_code_used`
  webhook fires; we audit `recovery_code_used`. We do not record
  which code was used (we don't see them).

## Alternatives considered

### Option A — Codes pass through our app (literal `tasks.md` reading)

We'd need a WorkOS API that returns plaintext codes, hold them
transiently for the user to download, then 410 the endpoint. Nothing
on the WorkOS SDK surface area today does this — WorkOS exposes
`listAuthFactors` (presence + type) but not plaintext codes. We'd be
asking WorkOS to widen their API or building an in-memory holding
pen, both of which expand attack surface without obvious user benefit
(AuthKit's hosted UI already shows the codes once at enrolment).
Rejected.

### Option B — Reissue path only (we never see codes, but we own the regenerate flow)

WorkOS offers a `regenerateAuthFactor`-style API that invalidates
prior codes and issues fresh ones. We could expose a "regenerate
recovery codes" application method that triggers this and redirects
the user back into AuthKit's display screen. FR17(c) (regenerate at
any time) would be served. Considered viable but out of T-010's
scope as written — and FR17(c) is not currently load-bearing for any
user story. Defer to a Phase-2 enrolment-management task.

### Option C — Delegate everything to AuthKit ✅ chosen

- ✅ Matches `design.md` §`recovery_codes` exactly — zero plaintext
  exposure on our side.
- ✅ Smallest application surface to test, audit, and rotate around.
- ✅ AuthKit's hosted UI is the most-tested surface for MFA enrolment
  in WorkOS's product; piggybacking inherits their UX investment.
- ✅ FR17(a) "view once" and FR17(b) "download as text file" are both
  handled inside the AuthKit redirect — the user sees them in the
  same flow that completes enrolment, so FR17 is satisfied
  end-to-end before our webhook even fires.
- ❌ FR17(c) "regenerate at any time" is not delivered until a
  future task wires the regenerate API call. Captured below.
- ❌ The user's only chance to download is during the AuthKit redirect
  — we cannot offer a "download again" button later. Mitigation:
  AuthKit's screen is explicit ("save these now, you won't see them
  again"); regenerate is the recourse if they lose them.

## Consequences

### Positive

- T-010 ships small: two webhook reaction functions, no new DB
  columns, no new SDK methods, no in-memory holding.
- Every concern in NFR8 (no logging of recovery codes) is satisfied
  by construction — we never have them to log.
- SOC 2 scope on recovery-codes handling collapses to "we don't
  handle them; WorkOS does" — one less audit-evidence surface for
  the eventual SOC 2 push.
- Bradley's incoming-CTO posture of "engineer for the stricter bar"
  is preserved: the only system that sees plaintext codes is the
  one that issues them.

### Negative / trade-offs

- FR17(c) regenerate is unimplemented until a separate task picks it
  up. Acceptable — no current user story depends on it; the
  recourse-on-loss path during MVP is "support reissues codes via
  WorkOS dashboard".
- Coupling to AuthKit's hosted UI means the visual treatment of the
  recovery-codes screen lives outside our codebase. Acceptable —
  T-017's web shell is deliberately ugly anyway; visual polish is
  in the `onboarding-flow` slice's scope.
- `tasks.md` T-010 needed editing to reflect the trimmed scope;
  done in the same PR as this ADR.

### Follow-ups / obligations

1. **FR17(c) regenerate task** — open as a backlog item for a
   later auth-and-orgs slice or for `onboarding-flow`. Scope:
   add `regenerateRecoveryCodes` to the WorkOS wrapper, expose an
   application function, audit `mfa_enrolled` (with metadata
   `{ regenerated: true }`) when WorkOS confirms the rotate.
2. **`listAuthFactors` wrapper method** — flagged in HANDOFF.md
   sticky knowledge #15 as the substitute for the current
   `isMfaPresent` default-trust behaviour in signup/login. Still
   wanted; not blocked by this ADR; not in T-010's scope as
   trimmed.
3. **AuthKit screen copy review** — confirm the AuthKit recovery-
   codes screen text says "save these now, you cannot see them
   again" in plain language. If not, surface a request to WorkOS;
   our web shell (T-017) will not have a fallback download path.
4. **Audit-event metadata on `mfa_enrolled` and
   `recovery_code_used`** — must never include the codes
   themselves, even in an `error` field on a failed lookup.
   `application/audit.ts`'s NFR8 strip pattern catches the keyword
   `recovery_code` already; defence-in-depth is in place.

## References

- Spec: `specs/ai-data-room/auth-and-orgs/requirements.md` §FR17,
  §FR18.
- Spec: `specs/ai-data-room/auth-and-orgs/design.md` §`recovery_codes`
  table note.
- Spec: `specs/ai-data-room/auth-and-orgs/tasks.md` §T-010 (trimmed
  scope post-this-ADR).
- HANDOFF.md sticky knowledge #15 (MFA-presence pluggability).
- ADR-001 (WorkOS as auth platform) — establishes the
  delegate-by-default posture this ADR extends to recovery codes.
