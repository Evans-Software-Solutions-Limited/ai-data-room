# Requirements — `auth-flow-error-generic`

**Status:** draft
**Parent slice:** [auth-and-orgs](../../requirements.md)
**HANDOFF#:** #1
**Owner:** Bradley
**Last updated:** 2026-05-27

## Context

Four error classes in `microservices/core/src/application/` follow a
nearly identical shape — each is a thin `Error` subclass with a
`reason` discriminant property:

- `InvitationError` ([invitations.ts:78](../../../../../microservices/core/src/application/invitations.ts)) — reason is parameter, 5 variants.
- `SuspensionError` ([suspension.ts:73](../../../../../microservices/core/src/application/suspension.ts)) — reason is parameter, 3 variants.
- `PasswordResetRequestError` ([password-reset.ts:41](../../../../../microservices/core/src/application/password-reset.ts)) — reason fixed at `"invalid_email"`, 1 variant.
- `PasswordResetCompletionError` ([password-reset.ts:54](../../../../../microservices/core/src/application/password-reset.ts)) — reason fixed at `"revoke_failed"`, 1 variant.

Spread across three files, each class repeats the same six-line
boilerplate (constructor stores `reason`, calls `super(reason)`,
sets `this.name`). HANDOFF#1 flags this as a candidate for a
single generic `AuthFlowError<R extends string>` in
`application/_errors.ts`.

## Functional requirements

- **FR1.** Provide a generic application-layer error class
  `AuthFlowError<R extends string>` that carries a `name` (the
  subclass-like identity) and a `reason` (the discriminant
  literal).
- **FR2.** The four existing call sites — `application/invitations.ts`,
  `application/suspension.ts`, and `application/password-reset.ts`
  (×2) — switch to the generic, preserving:
  - The `name` string each error currently exposes (`"InvitationError"`,
    `"SuspensionError"`, `"PasswordResetRequestError"`,
    `"PasswordResetCompletionError"`). Logs and structured-log
    fields key off `error.name`, so any change is a forensics
    regression.
  - The exact set of `reason` literals each error currently exposes.
    Handlers `switch` on `error.reason` to map to HTTP status; any
    silent broadening is a behaviour change.
- **FR3.** External symbol names (`InvitationError`, `SuspensionError`,
  `PasswordResetRequestError`, `PasswordResetCompletionError`)
  remain importable from their current module paths — handlers
  shouldn't have to relearn the import surface.

## Non-functional requirements

- **NFR1.** Type safety preserved. Each call site's `throw new …Error("foo")`
  must continue to fail typecheck if `"foo"` isn't one of the
  documented reasons for that flow. The generic's `<R extends string>`
  binding plus per-flow `Reason` union type aliases should be
  enough; no `as` casts permitted.
- **NFR2.** No bundle-size regression. The four-line `class X extends Error`
  shells weigh less than a generic + four aliases would; the
  acceptable bloat is ≤ a couple of lines in the dist output.
  (Mostly a sanity check — the generic is so small it's noise.)

## Out of scope

- Handler-side error mapping (the `switch (e.reason)` blocks) — that
  surface stays exactly as is. Only the throw side changes.
- Webhook-side error handling — webhook handlers don't throw these;
  they catch them implicitly via the application function returning
  a result type. No webhook touched.
- The `RepoNotFoundError` class in `infrastructure/repositories/` —
  different shape (no `reason`), different layer (infrastructure not
  application), out of scope.
- Domain-layer errors (none today; would be a separate concern).

## Acceptance criteria

- **AC1.** `bun run typecheck` passes after the rename.
- **AC2.** `bun run test` passes — all existing tests that throw or
  catch one of these errors continue to pass with no modification
  beyond import path adjustment (which they shouldn't even need —
  FR3).
- **AC3.** `bun run lint` + `bun run prettier:check` clean.
- **AC4.** `application/_errors.ts` exists, exporting `AuthFlowError`
  plus the per-flow reason unions. The four legacy class names are
  exported from their original modules as `class … extends AuthFlowError<…>`
  shells, so existing import paths keep working.
- **AC5.** No `error.name` regression. A grep for `error.name ===` or
  `.name ==` across the repo shows the legacy strings still match.
