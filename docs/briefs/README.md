# /briefs — product briefs

One-page brief per product initiative this repo ships. If a brief
grows beyond a page, promote the substance into a slice spec at
`.kiro/specs/<slug>/`.

- **Template:** `_TEMPLATE.md`
- **Naming:** `<slug>.md` — kebab-case slug. The slug is the same
  string used in `.kiro/specs/<slug>/` if there's a corresponding
  feature area.

## Current briefs

- `ai-data-room.md` — the product this repo builds.
- `monthly-report-agent.md` — internal automation context, kept here
  for traceability with the parent project. The agent itself ships
  separately as a Cowork plugin and isn't part of this repo's deploy
  surface.
