#!/usr/bin/env bash
# Drizzle drift check.
#
# Runs `drizzle-kit generate` and asserts that no new migration files
# appeared in `packages/db/migrations/`. If they did, the schema in
# `packages/db/src/schema/**` has drifted from the committed migrations
# and the author forgot to run `bun run db:generate` before pushing.
#
# Wired into CI by `.github/workflows/pr-checks.yml#db-checks`.
#
# Exits 0 = schema in sync. Exits 1 = drift detected.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Snapshot the migrations dir state before generation. We track both
# tracked-but-modified files (git diff) and net-new files (git status
# --porcelain) so a stray hand-edit to a checked-in migration is also
# caught.
PRE_DIRTY="$(git status --porcelain -- packages/db/migrations/ | wc -l | tr -d ' ')"

bun run db:generate >/dev/null

POST_DIRTY="$(git status --porcelain -- packages/db/migrations/ | wc -l | tr -d ' ')"

if [ "$POST_DIRTY" -ne "$PRE_DIRTY" ]; then
  echo "::error::drizzle schema drift detected — schema.ts has uncommitted migration."
  echo "Run 'bun run db:generate' locally and commit the new files in packages/db/migrations/."
  echo
  echo "Drift diff:"
  git status --porcelain -- packages/db/migrations/
  exit 1
fi

echo "✓ drizzle schema in sync with packages/db/migrations/"
