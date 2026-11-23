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

| Name | Purpose |
| --- | --- |
| `QA_SUPABASE_URL` | Playwright admin release-gate tests |
| `QA_SUPABASE_SERVICE_ROLE_KEY` | Playwright global setup |
| `QA_SUPABASE_PUBLISHABLE_KEY` | Playwright web app |
| `MAESTRO_APK_URL` | Optional URL to release-candidate APK for Maestro job |
| `MAESTRO_TEST_PHONE` / `MAESTRO_TEST_OTP` | QA branch test user (not Production) |

## Weekly crash-free sessions (PR template)

Pull the **crash-free sessions %** from Sentry → *Releases* or *Session Health* for the last 7 days and paste it into the PR template before a store build.