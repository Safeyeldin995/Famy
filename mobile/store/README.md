# Famy mobile — store submission drafts

Draft copy and checklists for Google Play and the Apple App Store. **Do not treat these files as legal advice.** The Product Owner must review before submission.

## URLs (use in both stores)

| Field | URL |
| --- | --- |
| Support / marketing site | https://famy-chi.vercel.app |
| Help | https://famy-chi.vercel.app/help |
| Privacy policy | https://famy-chi.vercel.app/content/privacy |
| Account deletion | https://famy-chi.vercel.app/account/delete |

## App identity (from `app.json`)

| Field | Value |
| --- | --- |
| `expo.name` (launcher default) | Famy |
| Store listing title (draft) | فامي / Famy — see `listing.*.md` |
| iOS home screen (localized) | Famy (en), فامي (ar) — `mobile/locales/*.json` (`CFBundleDisplayName`); Android launcher stays Famy unless localized labels are added later |
| Slug | `famy` |
| Deep link scheme | `famy` |
| iOS bundle ID | `com.famy.app` |
| Android application ID | `com.famy.app` |
| Marketing version | `1.0.0` (`expo.version`) |

Versioning for store builds is documented in [versioning.md](./versioning.md).

## Store listing copy

- English: [listing.en.md](./listing.en.md)
- Arabic: [listing.ar.md](./listing.ar.md)

## Google Play Data safety

Draft answers grounded in current app behavior: [play-data-safety.md](./play-data-safety.md)

## Assets and permissions

- [assets.md](./assets.md) — icons, splash, and gaps the PO must fill
- [permissions.md](./permissions.md) — Android/iOS permission audit

## Product Owner — not in this repo

- Google Play ($25) and Apple Developer ($99) accounts enrolled
- `EXPO_TOKEN` GitHub secret for CI APK builds (see root issue #295)
- EAS secrets for `GOOGLE_MAPS_ANDROID_API_KEY`, `GOOGLE_MAPS_IOS_API_KEY`
- `GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICES_PLIST` paths for production Firebase (not committed)
- Store screenshots and feature graphic (sizes in [assets.md](./assets.md))
- `eas submit` credentials — placeholders remain in `eas.json` under `submit.production`
