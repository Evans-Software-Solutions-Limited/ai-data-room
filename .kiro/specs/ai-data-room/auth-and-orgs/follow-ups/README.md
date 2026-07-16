# auth-and-orgs — Follow-up mini-spec index

**Status:** draft (manifest)
**Parent slice:** [../requirements.md](../requirements.md) · [../design.md](../design.md) · [../tasks.md](../tasks.md)
**Last updated:** 2026-05-27

## What this directory is

Slice 1 (`auth-and-orgs`) shipped complete at 22/22 tasks (T-022
sign-off merged in PR #28; tagged `v0.1.0-auth-and-orgs`). During the
slice, eleven follow-ups were flagged in the handoff (archived at
`docs/archive/2026-05-31-handoff-auth-and-orgs.md`) as "not blocking,
but worth doing soon." Per Bradley's
call on 2026-05-26: each gets its own kiro three-file mini-spec
(`requirements.md` → `design.md` → `tasks.md`) and its own background
task. **Not bundled.** Per the `feedback_kiro_spec_driven` memory rule,
even small follow-up refactors get spec'd before code lands.

This directory holds those mini-specs. Each subdirectory is one
follow-up; the manifest below tracks status + dependencies.

## Manifest

| Slug                                                                        | HANDOFF# | Shape                      | Status | Blocker                             | Why it's at this position                                                                                                                                                           |
| --------------------------------------------------------------------------- | -------- | -------------------------- | ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`infra-web-next-comment-stale`](./infra-web-next-comment-stale/)           | #9       | doc-only                   | draft  | —                                   | Smallest possible change (paragraph delete). Format-validation candidate.                                                                                                           |
| [`auth-flow-error-generic`](./auth-flow-error-generic/)                     | #1       | refactor (consolidate)     | draft  | —                                   | Four near-identical error class shells. Format-anchor mini-spec.                                                                                                                    |
| [`list-active-sessions-helper`](./list-active-sessions-helper/)             | #2       | refactor (extract)         | draft  | —                                   | Small `listActiveSessions` helper — NOT the full `revokeAllActiveSessions` HANDOFF named (the fan-out logic actually differs across the two callers; spec needed to call that out). |
| [`audit-reasons-constants`](./audit-reasons-constants/)                     | #6       | refactor (typing)          | draft  | —                                   | Replace stringly-typed `metadata.reason` literals with a const dictionary.                                                                                                          |
| [`shared-application-test-fixtures`](./shared-application-test-fixtures/)   | #3       | refactor (test infra)      | draft  | —                                   | Extract `makeUser` / `makeSession` / `makeOrg` etc. used across 8+ test files.                                                                                                      |
| [`lookup-user-or-audit-helper`](./lookup-user-or-audit-helper/)             | #7       | refactor (cross-aggregate) | draft  | —                                   | Five webhook callers now duplicate the same find-then-audit-failure block. Cross-aggregate refactor — largest of the unblocked set.                                                 |
| [`manual-gdpr-delete-script`](./manual-gdpr-delete-script/)                 | #4       | new functionality          | draft  | —                                   | Operator script referenced by `ops/runbooks/gdpr-delete.md` but doesn't exist yet. Has design surface (transactional? dry-run mode?) so spec'd substantively.                       |
| [`mfa-handler-webhook-wiring`](./mfa-handler-webhook-wiring/)               | #5       | blocked / spec-only        | draft  | WorkOS event-name investigation     | `handleMfaEnrolled` + `handleRecoveryCodeUsed` ship with tests but the v8.13 SDK doesn't expose the events as discriminated types. Sticky #21.                                      |
| [`production-frontend-url`](./production-frontend-url/)                     | #8       | blocked / spec-only        | draft  | Real prod domain to be confirmed    | `infra/api.ts` hardcodes `https://web.ai-data-room.example` for non-`$dev` stages. T-017 also duplicates the literal as `frontendOrigin`.                                           |
| [`external-grant-list-by-user-limit`](./external-grant-list-by-user-limit/) | #10      | blocked / spec-only        | draft  | Slice 3 (access-control)            | TODO in `externalGrantRepo.listByUser`. Fine at Capital Pay scale; slice 3 should add `where status = 'active' LIMIT N`.                                                            |
| [`caddy-dot-test-dev-domains`](./caddy-dot-test-dev-domains/)               | #11      | blocked / spec-only        | draft  | Slice 2 cross-subdomain cookie need | Vite proxy is Caddy-lite. Only converge with FDP's setup when slice 2 actually needs the cookie behaviour.                                                                          |

## Execution plan

**Phase 1 — Spec sweep (this batch).** Author the 11 mini-specs.
Each is small enough to fit in one PR. No code lands. The four
blocked items get specs anyway so the work is captured for when
the blocker clears.

**Phase 2 — Implement the seven unblocked.** One branch + PR per
follow-up, named `feat/auth-and-orgs-follow-up-<slug>` or
`chore/auth-and-orgs-follow-up-<slug>` depending on shape. After
each merges, tick its status in this manifest.

**Phase 3 — Pick up the four blocked specs when their blockers
clear.** Likely re-spawned at the relevant slice's spec sign-off.

## Conventions

- One follow-up = one subdirectory = one branch = one PR. Same as
  the parent slice's task convention; just narrower scope.
- Mini-spec shape: lean. Each file ~30–60 lines. The full kiro
  format is overkill at this scale, but the discipline of writing
  _why_ (requirements) → _how_ (design) → _steps_ (tasks) still
  earns its keep — see how `list-active-sessions-helper` discovers
  that HANDOFF #2's "identical blocks" claim is wrong.
- Branch name: `chore/auth-and-orgs-follow-up-<slug>` for pure
  refactors / doc fixes; `feat/auth-and-orgs-follow-up-<slug>` for
  new functionality (only `manual-gdpr-delete-script` qualifies).
- Status: `draft` → `signed-off` (Bradley acks the design) →
  `in-flight` (PR open) → `merged` (PR landed) → `closed` (manifest
  tick). Same status field at the top of each follow-up's
  `requirements.md`.
- "Reviewed SHA" line on the parent slice's matrix isn't needed
  here — these are small enough that the PR + commit history is
  the audit trail.

## Change log

- 2026-05-27 — Manifest authored. First mini-spec (`auth-flow-error-generic`)
  drafted as a format anchor. Remaining 10 mini-specs pending
  format ack from Bradley.
