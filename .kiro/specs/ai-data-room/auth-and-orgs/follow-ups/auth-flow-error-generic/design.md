# Design — `auth-flow-error-generic`

**Status:** draft
**Requirements:** [./requirements.md](./requirements.md)
**Last updated:** 2026-05-27

## Approach

Add `microservices/core/src/application/_errors.ts` exporting a
single generic class:

```ts
export class AuthFlowError<R extends string> extends Error {
  public readonly reason: R;

  constructor(name: string, reason: R) {
    super(reason);
    this.name = name;
    this.reason = reason;
    // Keeps the .name useful in V8/Node stack traces.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

The `Object.setPrototypeOf(this, new.target.prototype)` line preserves
the right prototype chain when a caller subclasses `AuthFlowError`
(needed because `extends Error` in TypeScript with old targets can
break `instanceof` — see FDP's `application/_errors.ts` for the same
guard).

Each of the four legacy errors becomes a one-line wrapper that pins
`name` + the `Reason` union:

```ts
// In application/invitations.ts
export class InvitationError extends AuthFlowError<InvitationErrorReason> {
  constructor(reason: InvitationErrorReason) {
    super("InvitationError", reason);
  }
}
```

The fixed-reason errors (`PasswordResetRequestError`,
`PasswordResetCompletionError`) get a no-arg constructor that hard-codes
the literal:

```ts
export class PasswordResetRequestError extends AuthFlowError<"invalid_email"> {
  constructor() {
    super("PasswordResetRequestError", "invalid_email");
  }
}
```

This preserves every call site's signature unchanged.

## Files touched

| File                                                   | Change                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `microservices/core/src/application/_errors.ts`        | **new** — generic `AuthFlowError<R>` + prototype guard.                                                                                                |
| `microservices/core/src/application/invitations.ts`    | Replace the 6-line `InvitationError` class with a 5-line subclass of `AuthFlowError<InvitationErrorReason>`. Imports `AuthFlowError` from `./_errors`. |
| `microservices/core/src/application/suspension.ts`     | Same pattern for `SuspensionError`.                                                                                                                    |
| `microservices/core/src/application/password-reset.ts` | Same pattern for both `PasswordResetRequestError` and `PasswordResetCompletionError` (no-arg constructors that hard-code the reason literal).          |

No other files touched. No handler code changes. No test changes (FR3 mandates this).

## Layered-architecture invariants

- `application/_errors.ts` stays in `application/`. The handler layer
  imports the legacy class names from their original locations
  (e.g. `import { InvitationError } from "../application/invitations"`),
  so the handler layer never reaches into `_errors.ts` directly.
  Preserves the layer boundary documented in CLAUDE.md.
- The generic is application-only. Infrastructure / domain don't
  import it. Future error classes in the same layer can subclass
  the same generic.
- The `_` prefix on `_errors.ts` matches the existing
  `_audit-context.ts` convention — files that are infrastructure
  for the layer, not public surface.

## Test surface

Existing unit tests for each application function already exercise
the throw + reason paths. They should pass unchanged:

- `application/__tests__/invitations.test.ts` — throws on race / role / etc.
- `application/__tests__/suspension.test.ts` — throws on self / sole-owner / not-found.
- `application/__tests__/password-reset.test.ts` — throws on invalid email / revoke failure.

**New test required:**

- `application/__tests__/_errors.test.ts` — three small asserts:
  1. `AuthFlowError` constructor sets `name`, `reason`, and `message`.
  2. `instanceof Error` and `instanceof AuthFlowError` both true.
  3. A subclass still reports its own `name` (i.e. `setPrototypeOf` works).
     Five-line test file.

No coverage drop (90% gate per workspace). The new generic adds ~10
lines of code and ~10 lines of test, so the ratio holds.

## Migration / compat impact

- **Compile-time only**. Every existing `throw new InvitationError("…")`
  call site has the same signature.
- **Catch-side**. `catch (e) { if (e instanceof InvitationError) … }`
  still narrows the same way. Handlers verified by re-running `bun run test`.
- **Runtime serialised shape**. `JSON.stringify(err)` returns the same
  fields (`name`, `message`, `reason`) — Powertools logger structured
  fields keyed off these stay identical.

## Risks / open questions

- **Risk 1.** TypeScript's `extends Error` historically broke `instanceof`
  for ES5 targets. Our `tsconfig.json` targets `ES2022`; the
  `Object.setPrototypeOf` line is belt-and-braces. **Mitigation:**
  the new unit test asserts `instanceof` works.
- **Risk 2.** Inspector Brad-style review surfaces "is the generic
  earning its keep at 4 call sites?" — defensible because (a) FDP
  uses the same pattern and (b) follow-up slices (access-control,
  doc-checklist) will add more `…Error` classes, so the generic
  amortises across slices. Mention this in the PR description.
- **Open Q1.** Does anything outside `microservices/core` ever import
  these errors? Treaty leaks `CoreApi` into `packages/web`, but the
  treaty surface only exposes response bodies, not throw types.
  **Action:** confirm with `grep -r "InvitationError\|SuspensionError\|PasswordResetRequestError\|PasswordResetCompletionError" microservices/web packages` during implementation; fold result into the PR description.

## ADR impact

None. This is an intra-layer refactor; no architectural decision
shifts.
