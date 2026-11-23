# Release quality gate — environment variables

Never commit DSNs or auth tokens. Set these in Vercel, EAS, and GitHub Actions secrets.

## Sentry

| Name | Surface | Purpose |
| --- | --- | --- |
| `VITE_SENTRY_DSN` | Web client | Browser crash and error reporting |
| `SENTRY_DSN` | Server (Nitro/Vercel) | SSR and server function errors |
| `EXPO_PUBLIC_SENTRY_DSN` | Mobile | JS + native (with EAS build + source maps) |
| `SENTRY_AUTH_TOKEN` | CI only | Upload mobile source maps after EAS build |
| `SENTRY_ORG` | CI only | Sentry organization slug |
| `SENTRY_PROJECT` | CI only | Sentry project slug (e.g. `famy-mobile`) |
| `SENTRY_RELEASE` | CI / deploy | Git SHA or EAS build version |

PII is stripped in `src/lib/sentry/scrub.ts` before events leave the app.

## QA automation (CI)

**Admin Playwright job** (`release-gate-admin-e2e`): **non-required** on PRs until a dedicated Famy QA Supabase branch exists. The job **fails closed** when any of these GitHub secrets is missing or points at Production:

| Secret | Purpose |
| --- | --- |
| `QA_SUPABASE_URL` | Must resolve to QA ref `bfwveoqbyqlhixjvdzha` |
| `QA_SUPABASE_PUBLISHABLE_KEY` | Anon/publishable key for that project |
| `QA_SUPABASE_SECRET_KEY` | Service role key (preferred name; not committed) |
| `FAMY_QA_APP_ORIGIN` | HTTPS origin of the QA preview app (not Production) |
| `FAMY_PRODUCTION_APP_ORIGIN` | Production app origin for guard alignment only |

`QA_SUPABASE_SERVICE_ROLE_KEY` is accepted as a legacy alias when writing `.env.qa.local`, but new setups should use `QA_SUPABASE_SECRET_KEY`.

**Maestro manual emulator** (`workflow_dispatch`): requires QA-built APK plus:

| Secret | Purpose |
| --- | --- |
| `MAESTRO_APK_URL` | HTTPS URL to APK whose bundle embeds QA Supabase ref only |
| `MAESTRO_TEST_PHONE` / `MAESTRO_TEST_OTP` | Firebase/QA test customer |
| `MAESTRO_PROVIDER_PHONE` / `MAESTRO_PROVIDER_OTP` | Provider journey |
| `MAESTRO_QA_BOOKING_ID` | UUID for cancel-flow assertion (QA seed) |

## Weekly crash-free sessions (PR template)

Pull the **crash-free sessions %** from Sentry → *Releases* or *Session Health* for the last 7 days and paste it into the PR template before a store build.