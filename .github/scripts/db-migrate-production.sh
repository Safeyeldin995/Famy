#!/usr/bin/env bash
# Apply explicit supabase/migrations SQL files to Production via psql.
# Invoked from .github/workflows/db-migrate.yml — inputs via env; do not pass secrets on argv.
set -euo pipefail

MIGRATION_DRY_RUN="${MIGRATION_DRY_RUN:-true}"
MIGRATION_FILES="${MIGRATION_FILES:-}"
MIGRATIONS_ROOT="${MIGRATIONS_ROOT:-}"
MIGRATION_REF_SHA="${MIGRATION_REF_SHA:-}"
RUNNER_ROOT="${RUNNER_ROOT:-}"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "::error::SUPABASE_DB_URL is not set. Add the repository secret before running this workflow."
  exit 1
fi

if [[ -z "$MIGRATION_FILES" ]]; then
  echo "::error::No migration files were provided."
  exit 1
fi

if [[ -z "$MIGRATIONS_ROOT" || ! -d "$MIGRATIONS_ROOT" ]]; then
  echo "::error::MIGRATIONS_ROOT must point to the staged migration directory."
  exit 1
fi

if [[ ! "$MIGRATION_REF_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "::error::MIGRATION_REF_SHA must be a full 40-character commit SHA."
  exit 1
fi

if [[ -z "$RUNNER_ROOT" || ! -f "$RUNNER_ROOT/qa/check-migration-transaction-control.mjs" ]]; then
  echo "::error::RUNNER_ROOT must reference the trusted main checkout."
  exit 1
fi

echo "Migration source commit: ${MIGRATION_REF_SHA}"

psql_conn() {
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 "$@"
}

install_pg_client() {
  sudo apt-get update -qq
  sudo apt-get install -y postgresql-client
  local major
  major="$(psql_conn -Atqc "SELECT current_setting('server_version_num')::int / 10000")"
  if ! dpkg -s "postgresql-client-${major}" >/dev/null 2>&1; then
    sudo apt-get install -y "postgresql-client-${major}"
  fi
  echo "Using PostgreSQL client for server major version ${major}."
  psql --version
}

parse_files() {
  local normalized
  normalized="$(printf '%s' "$MIGRATION_FILES" | tr ',\n\r' '   ')"
  local -a paths=()
  local token relpath abs
  for token in $normalized; do
    token="${token#"${token%%[![:space:]]*}"}"
    token="${token%"${token##*[![:space:]]}"}"
    [[ -z "$token" ]] && continue

    relpath="$token"
    relpath="${relpath#./}"
    if [[ "$relpath" != supabase/migrations/* ]]; then
      echo "::error::Path must be under supabase/migrations/: ${relpath}"
      exit 1
    fi
    if [[ "$relpath" == *".."* ]]; then
      echo "::error::Path traversal is not allowed: ${relpath}"
      exit 1
    fi
    if [[ ! "$relpath" =~ ^supabase/migrations/[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
      echo "::error::Unexpected migration filename: ${relpath}"
      exit 1
    fi
    abs="${MIGRATIONS_ROOT}/${relpath}"
    if [[ ! -f "$abs" ]]; then
      echo "::error::Staged migration file not found: ${relpath}"
      exit 1
    fi
    paths+=("$abs")
  done

  if [[ ${#paths[@]} -eq 0 ]]; then
    echo "::error::No valid migration paths after parsing input."
    exit 1
  fi

  printf '%s\n' "${paths[@]}"
}

assert_no_embedded_transactions() {
  local -a files=()
  mapfile -t files < <(parse_files)
  node "$RUNNER_ROOT/qa/check-migration-transaction-control.mjs" "${files[@]}"
}

migration_version() {
  local base="${1##*/}"
  base="${base%.sql}"
  printf '%s' "${base%%_*}"
}

migration_name() {
  local base="${1##*/}"
  base="${base%.sql}"
  printf '%s' "${base#*_}"
}

migration_relpath_log() {
  local abs="$1"
  local prefix="${MIGRATIONS_ROOT%/}/"
  printf '%s' "${abs#"$prefix"}"
}

functions_in_file() {
  local file="$1"
  grep -oiE 'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+([a-zA-Z0-9_"$.]+)' "$file" \
    | sed -E 's/.*FUNCTION[[:space:]]+//' \
    | sed 's/"//g' \
    | sort -u
}

print_function_md5s_for_file() {
  local file="$1"
  local -a names=()
  local fn schema name
  while IFS= read -r fn; do
    [[ -z "$fn" ]] && continue
    names+=("$fn")
  done < <(functions_in_file "$file")

  if [[ ${#names[@]} -eq 0 ]]; then
    echo "  (no CREATE FUNCTION statements detected in SQL)"
    return 0
  fi

  for fn in "${names[@]}"; do
    schema="public"
    name="$fn"
    if [[ "$fn" == *.* ]]; then
      schema="${fn%%.*}"
      name="${fn#*.}"
    fi
    if [[ ! "$schema" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || [[ ! "$name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
      echo "  (skip non-identifier function name: ${fn})"
      continue
    fi
    psql_conn -v schema="${schema}" -v fname="${name}" -Atq <<'SQL' | sed 's/^/  /'
SELECT format('%s.%s(%s) md5=%s',
  n.nspname,
  p.proname,
  pg_get_function_identity_arguments(p.oid),
  md5(pg_get_functiondef(p.oid))
)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = :'schema'
  AND p.proname = :'fname'
  AND p.prokind = 'f'
ORDER BY pg_get_function_identity_arguments(p.oid);
SQL
  done
}

run_dry_run() {
  local -a files=()
  mapfile -t files < <(parse_files)

  echo "Dry run: ${#files[@]} migration file(s) (each in BEGIN … ROLLBACK)."
  local file ok=0 fail=0 label
  for file in "${files[@]}"; do
    label="$(migration_relpath_log "$file")"
    echo "--- ${label}"
    if psql_conn <<SQL
BEGIN;
\\i ${file}
ROLLBACK;
SQL
    then
      echo "PASS: ${label}"
      ok=$((ok + 1))
    else
      echo "::error::FAIL: ${label}"
      fail=$((fail + 1))
    fi
  done
  echo "Dry run summary: ${ok} passed, ${fail} failed."
  [[ "$fail" -eq 0 ]]
}

run_apply() {
  local -a files=()
  mapfile -t files < <(parse_files)

  local txn_sql
  txn_sql="$(mktemp)"
  trap 'rm -f "$txn_sql"' EXIT

  {
    for file in "${files[@]}"; do
      printf '\\i %s\n' "$file"
    done
    for file in "${files[@]}"; do
      local version name
      version="$(migration_version "$file")"
      name="$(migration_name "$file")"
      cat <<SQL
INSERT INTO supabase_migrations.schema_migrations (version, name)
SELECT '${version}', '${name}'
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = '${version}'
);
SQL
    done
    printf "NOTIFY pgrst, 'reload schema';\n"
  } >"$txn_sql"

  echo "Applying ${#files[@]} migration file(s) in a single transaction."
  psql_conn -1 -f "$txn_sql"

  echo ""
  echo "=== Apply summary ==="
  local file label
  for file in "${files[@]}"; do
    label="$(migration_relpath_log "$file")"
    echo "Applied: ${label}"
    print_function_md5s_for_file "$file"
  done
}

main() {
  assert_no_embedded_transactions
  install_pg_client
  case "${MIGRATION_DRY_RUN,,}" in
    true | 1 | yes)
      run_dry_run
      ;;
    false | 0 | no)
      run_apply
      ;;
    *)
      echo "::error::Invalid MIGRATION_DRY_RUN value: ${MIGRATION_DRY_RUN}"
      exit 1
      ;;
  esac
}

main