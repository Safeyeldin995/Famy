# Versioning strategy (EAS)

Configured in `mobile/eas.json`:

- **`cli.appVersionSource`: `remote`** — production `version`, iOS `buildNumber`, and Android `versionCode` are stored on EAS and updated at build time rather than only from git.
- **`build.production.autoIncrement`: `true`** — each production store build bumps the native build number / version code on EAS.

Local `app.json` values:

- `expo.version` (`1.0.0`) — user-visible marketing version; bump when releasing noticeable product changes.
- `expo.ios.buildNumber` (`1`) — baseline for new projects; production builds defer to EAS remote values after the first production build.
- `expo.android.versionCode` (`1`) — same as iOS build number.

**Workflow**

1. Bump `expo.version` in `app.json` when you want users to see a new version string in the store listing.
2. Run `eas build --profile production` — EAS auto-increments build numbers for store binaries.
3. Do not commit Play/App Store signing keys; `submit.production` keeps placeholder credential paths.
