# Permissions audit

Based on Expo config (`app.json`, `app.config.js`) and code review (SDK 58).

## Android

| Permission | Status | Why |
| --- | --- | --- |
| `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` | **Requested** (foreground) | `expo-location` — pin service address (`LocationPicker.tsx`) |
| `READ_MEDIA_IMAGES` / legacy storage reads | **Blocked + picker** | Declared in `blockedPermissions`; library access uses the system photo picker only (no broad `READ_MEDIA_*` at install) |
| `POST_NOTIFICATIONS` | **Via expo-notifications** | Push notification opt-in |
| `INTERNET` | **Implicit** | API, auth, maps tiles |
| `CAMERA` | **Requested** (only when joining a live online lesson) | LiveKit video in online lessons (`@config-plugins/react-native-webrtc`) |
| `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` / `BLUETOOTH` | **Requested** (only when joining a live online lesson) | LiveKit audio in online lessons, including Bluetooth headsets |
| `SYSTEM_ALERT_WINDOW` | **Blocked** | Not needed |
| Background location | **Not requested** | No `ACCESS_BACKGROUND_LOCATION` |

## iOS

| Usage key | Status | English / Arabic |
| --- | --- | --- |
| `NSLocationWhenInUseUsageDescription` | **Yes** | Foreground map pin only — `app.json` + `mobile/locales/en.json` / `ar.json` |
| `NSPhotoLibraryUsageDescription` | **Yes** | Library picks for profile, receipts, provider ID docs |
| `NSCameraUsageDescription` | **Yes** | Live online lessons only — `app.json` + `mobile/locales/en.json` / `ar.json` |
| `NSMicrophoneUsageDescription` | **Yes** | Live online lessons only — `app.json` + `mobile/locales/en.json` / `ar.json` |

## Libraries that do not add extra store permissions

- `expo-document-picker` — system document UI (payment proof PDFs, provider uploads)
- `expo-notifications` — standard push entitlement
- Sign in with Apple / Google — OAuth in browser or native Apple sheet
