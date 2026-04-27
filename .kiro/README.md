# .kiro — feature specs

Kiro-style spec-driven development:
**Requirements → Design → Tasks → Implementation**.

Mirrors the layout of `funds-distribution-platform`'s `.kiro/specs/`.

## Layout

```
.kiro/specs/ai-data-room/<slice>/
  requirements.md   user stories + acceptance criteria + NFRs
  design.md         architecture, data model, API contracts, errors,
                    observability, deployment, security
  tasks.md          numbered T-001…T-NNN; each task references the
                    requirements it satisfies
```

## Rules

1. **Specs are the contract.** Read all three files for a slice before
   writing any code in that slice. Acceptance criteria (`AC-US*`) and
   non-functional requirements (`NFR*`) are testable; generated code
   must satisfy them.
2. **Edit specs in place.** This is the canonical home — there is no
   "upstream" copy to keep in sync. If you update a spec mid-slice,
   either bundle it into the same PR as the implementation change, or
   land a `chore(specs):` PR first.
3. **One slice per PR's scope.** Code touching slice 5 doesn't edit
   slice 6's spec.
4. **Status fields matter.** Each `requirements.md` and `design.md`
   has a status header (`draft` / `signed off`). Don't execute tasks
   from a slice whose `design.md` isn't `signed off` yet — flag it in
   the PR and surface the design question instead.

## Per-slice index

See `.kiro/specs/ai-data-room/README.md` for the slice list and
dependency order.
