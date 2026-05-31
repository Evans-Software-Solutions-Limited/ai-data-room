# Tasks — `auth-flow-error-generic`

**Status:** draft
**Design:** [./design.md](./design.md)
**Last updated:** 2026-05-27

One task — the whole change is small enough to ship as one PR. T-numbered
to match the parent slice's task convention even though there's only one.

---

## T-001 — Extract `AuthFlowError<R>` generic

Status: `[ ]`

**Scope.** Add `microservices/core/src/application/_errors.ts`
exporting a generic `AuthFlowError<R extends string>` class. Replace
the four legacy error class shells in `invitations.ts`,
`suspension.ts`, and `password-reset.ts` (×2) with one-line
subclasses that pin `name` + a per-flow `Reason` union literal.
Verify via `grep` that no consumer outside `microservices/core`
catches these errors by type, then fold the grep result into the
PR description.

**Files (likely):**

- **new** `microservices/core/src/application/_errors.ts` (generic + JSDoc, ~15 lines)
- **new** `microservices/core/src/application/__tests__/_errors.test.ts` (~15 lines)
- `microservices/core/src/application/invitations.ts` (replace `InvitationError` block; +import)
- `microservices/core/src/application/suspension.ts` (replace `SuspensionError` block; +import)
- `microservices/core/src/application/password-reset.ts` (replace both error blocks; +import)

**Definition of done:**

- `AuthFlowError<R>` exists in `_errors.ts` with prototype-chain guard. ✅
- All four legacy classes are one-line subclasses, preserving `name` strings + `reason` unions. ✅
- All existing application-layer tests pass unchanged. ✅
- New `_errors.test.ts` passes (covers ctor, `instanceof`, prototype guard). ✅
- `bun run typecheck && bun run test && bun run lint && bun run prettier:check` green. ✅
- Coverage gate (90% per workspace) still satisfied. ✅
- PR description names the four call sites + cites the grep result for downstream consumers. ✅

**Tests required:**

- New unit: `application/__tests__/_errors.test.ts` (3 small assertions).
- Existing unit tests for invitations / suspension / password-reset run unchanged.

**Branch:** `chore/auth-and-orgs-follow-up-auth-flow-error`
**PR title:** `chore(auth-and-orgs): extract AuthFlowError<R> generic`

---

## Out-of-band / Bradley actions

None. Pure intra-layer refactor.

## Dependencies

- No other follow-up mini-spec blocks or is blocked by this one.
- Independent from the parent slice's open T-022 (PR #28).
