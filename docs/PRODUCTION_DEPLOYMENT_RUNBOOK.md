# Famy Production Deployment Runbook

Companion to `docs/QA_ENVIRONMENT.md`. That file governs QA; this one
governs the real Production Supabase project and the Production Vercel
app. **Draft — Safeyeldin has not yet reviewed or approved this.** Several
sections below mark open questions only he can answer; do not treat this
as an approved procedure until those are resolved.

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
usage in the codebase as of 2026-08-24 — not from `.env.example`, which
currently documents only one variable (`VITE_VAPID_PUBLIC_KEY`) and is
stale. **Open item:** `.env.example` should be brought up to date with this
list in a follow-up task; until then, this table is the source of truth.

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
| `FAMY_PRODUCTION_APP_ORIGIN` | Canonical Production app URL, used by guardrails/tests that must never target Production |
| `FAMY_ENV` | Tier marker some code paths branch on |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel's own automation-bypass mechanism for protected deployments, if in use |

### Supabase Edge Function secrets (set via Supabase dashboard/CLI, separate from Vercel)

Only `send-push-notifications` exists today (`supabase/functions/send-push-notifications`):

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

82 migrations currently exist in `supabase/migrations/`, timestamp-ordered,
one-directional (no down-migrations in this repo). `QA_ENVIRONMENT.md`
already states the rule for QA: link the Supabase CLI to QA only when
deploying QA schema, and keep Production migrations on "a separate,
reviewed release path" — but no doc anywhere spells out what that path
actually is.

**Open question, needs Safeyeldin's answer before this section can be
called complete:** how has Production schema been kept in sync with `main`
so far — `supabase db push` run manually against the Production-linked
CLI, or applied by hand via the Supabase dashboard SQL editor? Milestone 3
of `FAMY_ROADMAP.md` already confirmed (2026-08-23, via Safeyeldin's own
Production read access) that schema is fully in sync with `main` today, so
*some* process has been working — it just isn't written down. Once
confirmed, this section should state that process explicitly, with the
exact command or dashboard steps.

Until that's answered, treat migration deployment as a manual,
individually-reviewed action — never automated, never bundled into a CI
step that runs against Production without a human in the loop.

## Rollback plan

**Resolved 2026-08-24 (Safeyeldin confirmed): PITR/backups are enabled on
the Production Supabase project.** A real rollback mechanism does exist —
this was the biggest open gap in this runbook, and it's now closed in
principle. There are still no down-migrations and no rollback tooling
anywhere in `qa/` or `tools/`, so "rollback" means using Supabase's own
PITR restore (a dashboard/support action, not anything in this codebase),
not reverting via a script here.

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
notifications. **Not started** — this section documents the requirement,
it does not claim it's wired up. Implementing it is separate work for
Cursor (not a docs change), scoped as its own task:

- Error tracking: nothing currently instrumented beyond whatever Vercel's
  default deployment logs capture. No dedicated error-tracking service
  (e.g. Sentry) found in `package.json` dependencies.
- Failed payments: `payments` table has a `status` column; no alerting
  reads it today.
- Failed notifications: `send-push-notifications` function exists; no
  alerting on its failure path was found.

## Pre-deploy checklist (draft)

Until the open questions above are resolved, this is a proposed shape, not
a final procedure:

1. Confirm `main`'s CI (`Unit, Typecheck, Build`) is green on the exact
   commit being deployed.
2. Confirm no pending, unreviewed migrations exist beyond what's already
   verified in sync (per the still-open migration-process question above).
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

**A full dry-run of "deploy this exact `main` to Production" still needs
to be reviewed and approved by Safeyeldin before it's ever executed for
real** — per Milestone 3's exit criteria in `FAMY_ROADMAP.md`. This
document is preparation for that review, not a substitute for it.
