# Production database migrations (GitHub Actions)

Production schema changes are applied with the **Production DB migrate** workflow. It runs an explicit list of SQL files from this repository against the Production Postgres database using `psql`. It does **not** use `supabase db push`, because Production `supabase_migrations.schema_migrations` history does not match repo migration filenames and a blind push could re-apply old migrations.

## One-time setup

### 1. Repository secret `SUPABASE_DB_URL`

1. In Supabase: **Project Settings → Database → Connection string** (URI).
2. Use the **direct** Postgres connection (not the pooler) when running large DDL in one transaction.
3. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `SUPABASE_DB_URL`
   - Value: the Postgres URI (includes password). Never commit or paste this into issues, PRs, or chat.

The workflow fails closed if the secret is missing. Logs never print the URL.

### 2. GitHub environment `production`

1. **Settings → Environments → New environment** → name: `production`
2. Enable **Required reviewers** and add Safeyeldin (Product Owner) so every real apply needs approval.
3. Dry runs still use the `production` environment; reviewers can approve or skip per your policy.

## How to run

1. **Actions → Production DB migrate → Run workflow**
2. **ref:** full **40-character commit SHA** on `main` (or the merged release commit). Branch names are not accepted.
3. **files:** migration paths, one per line or comma-separated, **in dependency order**, for example:

   ```text
   supabase/migrations/20261116120000_cancellation_fee_policy.sql
   supabase/migrations/20261116150000_customer_fee_debts.sql
   ```

4. **dry_run:** leave `true` first. The job runs each file in `BEGIN … ROLLBACK` and reports PASS/FAIL per file.
5. When dry run is green, run again with **dry_run = false** and approve the environment gate.

### Apply behavior (`dry_run = false`)

- Migration SQL is loaded with `git show <sha>:<path>` from the supplied commit; the workflow script itself always comes from **`main`**.
- Files are validated with **libpg_query** (npm `libpg-query@17.8.3`): top-level `TransactionStmt` (including `COMMIT WORK`, savepoints, prepared transactions) or `CALL` are **rejected** — they would break the outer transaction wrapper. `COMMIT` inside function bodies is allowed. Top-level `SET` / `set_config()` on lexer GUCs (`standard_conforming_strings`, `backslash_quote`, `escape_string_warning`, `client_encoding`) is also rejected.
- `psql` runs with `PGOPTIONS='-c standard_conforming_strings=on'` so execution matches validation.
- All listed files run in **one** transaction (`ON_ERROR_STOP`; failure rolls back everything).
- Each file records a row in `supabase_migrations.schema_migrations` (`version` = 14-digit timestamp, `name` = rest of filename) only if that `version` is not already present.
- PostgREST schema reload: `NOTIFY pgrst, 'reload schema'`.
- The job summary lists each applied file and the `md5` of function definitions referenced by `CREATE [OR REPLACE] FUNCTION` in that file (for audit drift checks).

## Safety rules

- List only files that are missing from Production or are known safe to re-run idempotently. The workflow does not skip files already in `schema_migrations`; duplicate **DDL** can still fail or do harm.
- Never use this workflow to paste ad-hoc SQL; only paths under `supabase/migrations/` that exist at `ref`.
- Do not rely on Supabase MCP copy-paste for large migration batches (#397-scale); use this workflow instead.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Secret error at start | `SUPABASE_DB_URL` not set on the repository |
| Path validation error | Path not under `supabase/migrations/` or wrong filename pattern |
| Dry run FAIL on one file | SQL error; fix migration or order dependencies |
| Apply fails mid-batch | Whole transaction rolled back; fix SQL and re-run after dry run |
| Waiting for approval | `production` environment reviewers must approve the run |

## Related

- Engineering contract: `AGENTS.md` (migrations applied to Production only after review and drift checks).
- Issue: [#404](https://github.com/Safeyeldin995/Famy/issues/404).