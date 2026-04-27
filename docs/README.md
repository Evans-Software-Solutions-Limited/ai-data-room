# docs/

Engineering and product docs that live with the repo.

- `briefs/` — product brief(s). One page per initiative; if it grows, it's a spec.
- `slices/` — per-slice traceability matrix (one file per completed slice; landed by the slice's final task).
- `next-steps-deployments.md` — template-inherited notes on SST deployment setup; archive / rewrite as we make the SST stages concrete.
- `privacy/` — privacy docs referenced from specs (PostHog posture etc.) — created lazily when a slice needs one.

ADRs live at `adr/` at repo root, not under `docs/`. This is a small, deliberate divergence from FDP (which keeps them under `docs/adr/`) — top-level visibility for decision contracts.
