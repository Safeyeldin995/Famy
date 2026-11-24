#!/usr/bin/env bash
# Harness: exercise run_dry_run with a mocked psql (no database). Used by unit tests.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/.github/scripts/db-migrate-production.sh"

MIGRATIONS_ROOT="${MIGRATIONS_ROOT:?}"
MIGRATION_FILES="${MIGRATION_FILES:?}"

eval "$(sed -n '72,110p;130,134p;186,217p' "$SCRIPT")"

psql_conn() {
  return 0
}

run_dry_run
exit 0