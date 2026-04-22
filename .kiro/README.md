# .kiro — checked-in spec snapshot

Kiro-style spec-driven development: **Requirements → Design → Tasks → Implementation**.

## Canonical vs. snapshot

The canonical specs live in the **upstream project workspace** (not this repo):

```
~/.../Automation, AI Workflows & Revenue Streams/specs/ai-data-room/<slice>/
  requirements.md
  design.md
  tasks.md
```

`.kiro/specs/ai-data-room/` here is a **snapshot** of those specs, checked in so PRs have something to point at and Claude Code agents running inside the repo have the full context without needing to mount the Cowork workspace.

## Rules

1. **Don't edit under `.kiro/specs/` from inside the repo.** Propose edits in the upstream workspace, get sign-off, then sync the snapshot down.
2. **Sync cadence:** snapshot is updated whenever a slice's spec reaches a phase checkpoint (reqs signed off, design signed off, tasks drafted).
3. **One slice per PR.** The snapshot and any code implementing the spec land together.

## Per-slice status

See upstream `specs/ai-data-room/README.md` for the current sign-off state of each slice. As of the last snapshot: all 9 slices are **requirements + design + tasks drafted**, pending Bradley sign-off on design to unblock task execution for slice 1.
