# Versioning strategy (EAS)

Configured in `mobile/eas.json`:

- **`cli.appVersionSource`: `remote`** — production `version`, iOS `buildNumber`, and Android `versionCode` live on EAS, not in git. Local `ios.buildNumber` / `android.versionCode` in `app.json` are omitted so EAS does not warn about ignored values.
- **`build.production.autoIncrement`: `true`** — each production store build bumps the native build number / version code on EAS.

Local `app.json`:

- **`expo.version`** (`1.0.0`) — user-visible marketing version; bump when releasing noticeable product changes.
- **Do not** set `expo.ios.buildNumber` or `expo.android.versionCode` while `appVersionSource` is `remote`.

**Workflow**

1. Bump `expo.version` in `app.json` when you want users to see a new version string in the store listing.
2. Run `eas build --profile production` — EAS auto-increments build numbers for store binaries.
3. Do not commit Play/App Store signing keys; `submit.production` keeps placeholder credential paths.
