# Famy QA Environment Runbook

## Production vs QA separation

Famy Production and Famy QA are **separate Supabase projects**. QA commands must never target Production credentials.

| Tier | Supabase project | App origin | Env file |
|---|---|---|---|
| Production | Production ref (dashboard) | Production Vercel URL | `.env` / Vercel Production env |
| QA / local E2E | Famy QA ref `bfwveoqbyqlhixjvdzha` | Local `:8099` or QA Preview URL | `.env.qa.local` only |

## Local QA setup

1. Copy `.env.qa.example` → `.env.qa.local` (never commit `.env.qa.local`).
2. Fill in values from the **Famy QA** Supabase dashboard:
   - `FAMY_QA_SUPABASE_PROJECT_REF=bfwveoqbyqlhixjvdzha`
   - `FAMY_PRODUCTION_SUPABASE_PROJECT_REF=<production-ref>`
   - `QA_SUPABASE_URL=https://bfwveoqbyqlhixjvdzha.supabase.co`
   - `QA_SUPABASE_PUBLISHABLE_KEY=<publishable-key>`
   - `QA_SUPABASE_SECRET_KEY=<secret-key>` (Node-only; never `VITE_` prefix)
   - `FAMY_QA_APP_ORIGIN=http://localhost:8099` (or your QA Preview URL)
   - `FAMY_PRODUCTION_APP_ORIGIN=https://famy-chi.vercel.app`
3. Run read-only preflight:

```bash
npm run qa:preflight
```

Preflight validates tier, project refs, origins, and credential presence **without connecting or writing**.

## Safe schema deployment (QA)

1. Link Supabase CLI to **Famy QA** only when deploying QA schema.
2. Never run `supabase db push`, migrations, or destructive SQL against Production from a QA workflow.
3. Keep Production migrations on a separate, reviewed release path.

## Vercel Preview with QA

- Configure Preview environment variables to use **QA Supabase** publishable/secret keys and URL.
- Set `FAMY_QA_APP_ORIGIN` to the Preview deployment URL in `.env.qa.local` when running remote E2E against Preview.
- Remote E2E **cannot** target the Production app origin.

## Running QA tests

All QA write commands load `.env.qa.local` only and run preflight first:

```bash
npm run qa:preflight
npm run test:e2e
npm run test:otp-integration
```

`KEEP_QA_DATA=1` skips teardown but **does not** skip preflight.

## Dry-run cleanup

Cleanup defaults to **dry-run** (counts and masked IDs only):

```bash
npm run test:e2e:cleanup
```

Destructive cleanup requires explicit confirmation:

```bash
node qa/cleanup.mjs --execute --confirm=I-UNDERSTAND-QA-CLEANUP
```

Cleanup refuses the Production project ref and non-synthetic users.

## Prohibited against Production

Never run these against Production credentials or the Production Supabase ref:

- `npm run test:e2e`
- `npm run test:otp-integration`
- `npm run test:e2e:cleanup` with `--execute`
- `qa/global-setup.ts` / Playwright global setup
- Any script importing `qa/admin-client.mjs` for writes

Production builds (`npm run build`) continue to use `.env` / Vercel Production variables and are unchanged by QA guardrails.
