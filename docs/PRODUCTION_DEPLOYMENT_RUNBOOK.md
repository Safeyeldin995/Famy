# Famy Production Deployment Runbook

Companion to `docs/QA_ENVIRONMENT.md`. That file governs QA; this one
governs the real Production Supabase project and the Production Vercel
app.

## Production vs QA separation (unchanged from QA_ENVIRONMENT.md)

| Tier | Supabase project | App origin | Env file |
|---|---|---|---|
| Production | Production ref (masked `mjhk…nojp` elsewhere in this repo) | `https://famy-chi.vercel.app` (`FAMY_PRODUCTION_APP_ORIGIN`) | `.env` / Vercel Production env |
| QA / local E2E | Famy QA ref `bfwveoqbyqlhixjvdzha` | Local `:8099` or QA Preview URL | `.env.qa.local` only |

Every guardrail in `qa/` and `tools/production-reset/` that checks the
Production ref checks it against this same value. Never paste the raw ref
into a chat message, log, or committed file — mask it as `mjhk…nojp`.

## Environment variables

Compiled from actual `process.env.*` / `import.meta.env.*` / `Deno.env.get()`
usage in the codebase — not from `.env.example`, which is not kept
up to date automatically. **Open item:** `.env.example` should be brought
up to date with this list in a follow-up task; until then, this table is
the source of truth.

### Vercel — client-exposed (`VITE_` prefix, bundled into the browser build)

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Production Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` (alias seen in code: `VITE_SUPABASE_ANON_KEY`) | Supabase publishable/anon key |
| `VITE_VAPID_PUBLIC_KEY` | Push notification public key; blank keeps push in its documented "not available yet" state |

### Vercel — server-only (no `VITE_` prefix; must never leak to the client bundle)

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Server-side Supabase URL (server code paths) |
| `SUPABASE_PUBLISHABLE_KEY` | Server-side publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Full-privilege key — server-only, never in client code, never logged |
| `AUTH_INTENT_SECRET` | Signs/verifies auth-intent tokens; `requireAuthIntentSecret()` throws if unset — **deploy fails closed, not open, if this is missing**, confirmed by `src/lib/auth/__tests__/authIntent.secret.test.ts` |
| `META_WHATSAPP_ACCESS_TOKEN` | WhatsApp Business API access token |
| `META_WHATSAPP_PHONE_NUMBER_ID` | WhatsApp sending number ID |
| `META_WHATSAPP_TEMPLATE_NAME` / `META_WHATSAPP_TEMPLATE_LANGUAGE` / `META_WHATSAPP_TEMPLATE_BUTTON_TYPE` | OTP template configuration |
| `FIREBASE_*` (server-side Admin SDK credentials — project ID, client email, private key) | Firebase Phone Auth OTP provider (added after this runbook's first draft); required only when `OTP_PROVIDER=firebase` |
| `FAMY_PRODUCTION_APP_ORIGIN` | Canonical Production app URL, used by guardrails/tests that must never target Production |
| `FAMY_ENV` | Tier marker some code paths branch on |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel's own automation-bypass mechanism for protected deployments, if in use |
| `PAYMOB_SECRET_KEY` | Paymob Egypt Intention API secret key (`Authorization: Token …`) — server-only, never client |
| `PAYMOB_PUBLIC_KEY` | Paymob public key for Unified Checkout redirect URL — server-only (checkout URL is returned to authenticated clients, not embedded in the bundle) |
| `PAYMOB_HMAC_SECRET` | Paymob Transaction Processed webhook HMAC secret — server-only |
| `PAYMOB_INTEGRATION_ID` | Paymob card/wallet integration ID passed to Intention API |
| `PAYMOB_NOTIFICATION_URL` | Optional override for Paymob webhook URL; defaults to `${SUPABASE_URL}/functions/v1/paymob-webhook` |

### Supabase Edge Function secrets (set via Supabase dashboard/CLI, separate from Vercel)

Only `send-push-notifications` and `paymob-webhook` exist today:

| Function | Secrets / notes |
|---|---|
| `send-push-notifications` | See table below |
| `paymob-webhook` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMOB_HMAC_SECRET` — `verify_jwt = false`; HMAC on `?hmac=` query param is the only auth gate (see `supabase/functions/paymob-webhook/index.ts`) |

`send-push-notifications` secrets:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Function's own Supabase client |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push signing |
| `NOTIFICATION_WORKER_SECRET` | Function checks `x-worker-secret` itself — `verify_jwt = false` is intentional (see `config.toml` comment), so this secret is the *only* thing gating the endpoint. Confirm it's set before this function goes live in Production; an unset value likely fails closed given the codebase's general pattern, but this should be verified directly against `index.ts`, not assumed. |

### Open question — who holds the real values

This document lists variable *names* and *purposes*, not values. Safeyeldin
holds (or can retrieve from Vercel/Supabase dashboards) the actual
Production secrets. **No agent should ever request, paste, or store these
values in chat, commits, or logs.**

## Migration application order

The migration-apply process was genuinely undocumented until 2026-08-27,
when three pending migrations were applied to Production for the first
time under direct observation. What actually happened:

**Confirmed working manual process:** for each migration file, in
timestamp order, its SQL was pasted directly into the Production
project's Supabase Dashboard → SQL Editor and run, after explicitly
confirming the Project Reference ID shown in the dashboard matched the
known Production ref (masked `mjhk…nojp`) — never assumed from a tab
label or memory. This is a real, working, human-confirmed process and
should be treated as the documented one going forward.

**Open finding, not yet explained — flagging rather than guessing:**
before running anything, a pre-check found that 2 of the 3 pending
migrations (`20260824150000_error_logs_monitoring.sql` and
`20260827120000_error_log_client_rate_limits.sql`, both merged as part
of PR #48) were **already present on Production** — table and function
objects for both existed, despite neither ever having gone through the
manual SQL Editor process. A third migration
(`20260826150000_featured_promo_codes.sql`, merged earlier via PR #50)
was confirmed **not** present and required the manual step above. This is
inconsistent with a purely-manual process and suggests something
automatic may be applying some migrations to Production on merge to
`main` — possibly a Supabase GitHub integration (Project Settings →
Integrations), though this has not been confirmed.

**Recommended before this section can be called fully resolved:**
Safeyeldin should check the Production Supabase project's own
**Database → Migrations** history (which timestamps how and when each
migration was actually applied) and **Settings → Integrations** (for a
connected GitHub auto-migration integration). Until that's checked, treat
the two possibilities as both live: (a) an undocumented automatic path
exists and needs to be either formalized or disabled in favor of the
explicit manual process, or (b) someone applied those two by hand outside
any recorded process. Either way, **always verify current state with a
read-only existence check before applying anything** (see the pattern
used successfully on 2026-08-27: query `information_schema.tables` /
`pg_proc` for the objects a migration would create, rather than assuming
"pending" from the migrations folder alone) — this protects against both
failure modes regardless of which one is true.

Migrations remain one-directional (no down-migrations exist in this
repo). Keep every migration additive-only (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`) so a
partially-applied or re-run state fails safely rather than corrupting
data — this pattern held up in practice on 2026-08-27 even with the
already-applied-migrations surprise above.

## Rollback plan

**Resolved 2026-08-24 (Safeyeldin confirmed): PITR/backups are enabled on
the Production Supabase project.** A real rollback mechanism does exist.
There are still no down-migrations and no rollback tooling anywhere in
`qa/` or `tools/`, so "rollback" means using Supabase's own PITR restore
(a dashboard/support action, not anything in this codebase), not
reverting via a script here.

**Still open, smaller item:** the exact PITR retention window (how far
back restores can go) hasn't been confirmed yet — needed to state
precisely what "how far can we roll back" means in practice. Until that's
confirmed, treat the safe assumption as "restore is possible, but don't
rely on a specific window without checking the Supabase dashboard's
current backup settings at deploy time."

Two mechanisms exist in total, in order of preference:

1. **Point-in-time recovery (PITR)** — confirmed enabled. This is the
   primary rollback path for a bad Production migration going forward.
2. **A hand-written compensating migration** — for cases where a full PITR
   restore is undesirable (e.g. it would also revert unrelated legitimate
   writes that happened after the bad migration), accept that "rollback"
   means writing and reviewing a *new* forward migration that undoes the
   damage, not reverting to a prior schema snapshot.

## Monitoring / alerting minimum

Roadmap Milestone 3 requires a minimum of: errors, failed payments, failed
notifications. **Application-side capture shipped 2026-08-30** (PR #48):
`error_logs` table + `admin_monitoring_summary` RPC, client/server error
boundary wiring, `/admin/monitoring` dashboard showing 7-day counts for
errors, failed/rejected payments, and failed/dead notifications, with
Postgres-backed rate limiting on the public error-report endpoint. This
is now live on Production (migration confirmed applied 2026-08-27).

**Still not started:** proactive alerting/paging (e.g. someone gets
notified without having to open `/admin/monitoring`). This was explicitly
scoped out of PR #48 as a separate future product decision, not an
oversight.

## Pre-deploy checklist

1. Confirm `main`'s CI (`Unit, Typecheck, Build`) is green on the exact
   commit being deployed.
2. Before applying any migration, run a read-only existence check
   (`information_schema.tables` / `pg_proc` for the objects it creates)
   against Production first — do not assume "pending" from the migrations
   folder alone (see the Migration application order section above for
   why).
3. Confirm all required env vars (tables above) are set in Vercel
   Production and, separately, as Supabase Edge Function secrets — these
   are two different places and it's easy to update one and forget the
   other.
4. Deploy via Vercel's normal Production deployment path (this repo
   already has Vercel wired to `main` per the CI checks visible on every
   PR).
5. Smoke-test the deployed app against the real Production origin
   (`FAMY_PRODUCTION_APP_ORIGIN`) — manually, not via `npm run test:e2e`,
   which is QA-only per `QA_ENVIRONMENT.md` and must never target
   Production.
