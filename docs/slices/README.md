# docs/slices

One `traceability matrix` document per completed slice, landing with the slice's final task (`T-<last>` in each slice's `tasks.md`).

Example — from slice 1's T-015:

```
# auth-and-orgs — traceability

| Requirement | Design §     | Task(s)       | Test(s)                              |
|-------------|--------------|---------------|--------------------------------------|
| FR1         | Boundary     | T-007         | tests/e2e/auth/mfa-gate.spec.ts      |
| FR21        | Session cache| T-008, T-010  | tests/e2e/auth/suspension.spec.ts    |
| NFR4        | Rate-limit   | T-013         | tests/security/rate-limit.spec.ts    |
| AC-US3      | -            | T-014         | tests/e2e/auth/owner-signup.spec.ts  |
```

Populated on each slice's sign-off task (the final `T-<N>`). MVP traceability is the composition of all nine matrices.
