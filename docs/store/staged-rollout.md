# Staged store rollout

## Android

1. **Internal testing** — smoke the release-candidate APK on the device matrix ([release-checklist.md](../qa/release-checklist.md)).
2. **Closed testing** — ~20 real users for **14 days** (Google requirement for new personal Play accounts).
3. **Production** — start at **10%** → **50%** → **100%** only when **crash-free sessions ≥ 99.5%** (Sentry weekly).
4. Halt or roll back if crash-free sessions drop below **99.5%** or any open **P1** appears.

## iOS

1. **TestFlight external** beta first.
2. **Phased release** in App Store Connect after the same crash-free and checklist gates.

## Online lessons kill switch

Admins toggle **Online lessons** under **Settings → Release features**. `online_lessons_enabled()` is read server-side — no new build required to disable new online bookings.

## Environment

| Variable | Where |
| --- | --- |
| `EXPO_PUBLIC_SENTRY_DSN` | Mobile EAS profiles |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | Web / Vercel |
| `SENTRY_AUTH_TOKEN` | CI source map upload (optional) |
| `SENTRY_ORG` / `SENTRY_PROJECT` | CI source map upload |