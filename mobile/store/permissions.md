# Permissions audit

Based on Expo config (`app.json`, `app.config.js`) and code review (SDK 58).

## Android

| Permission | Status | Why |
| --- | --- | --- |
| `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` | **Requested** (foreground) | `expo-location` — pin service address (`LocationPicker.tsx`) |
| `READ_MEDIA_IMAGES` / legacy storage reads | **Via image picker** | Photo library picks only; no camera capture |
| `POST_NOTIFICATIONS` | **Via expo-notifications** | Push notification opt-in |
| `INTERNET` | **Implicit** | API, auth, maps tiles |
| `CAMERA` | **Blocked** | `blockedPermissions` + `cameraPermission: false` on image picker |
| `RECORD_AUDIO` | **Blocked** | No microphone features |
| `SYSTEM_ALERT_WINDOW` | **Blocked** | Not needed |
| Background location | **Not requested** | No `ACCESS_BACKGROUND_LOCATION` |

## iOS

| Usage key | Status | English / Arabic |
| --- | --- | --- |
| `NSLocationWhenInUseUsageDescription` | **Yes** | Foreground map pin only — `app.json` + `mobile/locales/en.json` / `ar.json` |
| `NSPhotoLibraryUsageDescription` | **Yes** | Library picks for profile, receipts, provider ID docs |
| `NSCameraUsageDescription` | **No** | Camera not used |
| `NSMicrophoneUsageDescription` | **No** | Microphone not used |

## Libraries that do not add extra store permissions

- `expo-document-picker` — system document UI (payment proof PDFs, provider uploads)
- `expo-notifications` — standard push entitlement
- Sign in with Apple / Google — OAuth in browser or native Apple sheet
