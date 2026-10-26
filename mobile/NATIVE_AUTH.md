# Native sign-up, OTP, and password flows

The app calls Famy web API routes under `/api/mobile/otp/*` and `/api/mobile/auth/*` using the `webOrigin` value from `app.json` `extra`. Signed auth intents are returned in each JSON body as `intents` and replayed on the next request via the `X-Famy-Auth-Intents` header (stored in SecureStore on device). Requests use `credentials: "omit"` — not browser cookies.

## OTP provider (server)

When the web app uses the **mock** or **Meta** OTP provider, the native app only talks to the server endpoints (SMS/WhatsApp is sent server-side).

## Firebase phone OTP (optional native build)

When production is configured with **Firebase** OTP on the web (`VITE_OTP_PROVIDER=firebase`), the native app:

1. Calls `POST /api/mobile/otp/send` to create the server auth intent.
2. Sends SMS via `@react-native-firebase/auth` on device.
3. Calls `POST /api/mobile/otp/confirm-firebase` after SMS succeeds.
4. Verifies with `POST /api/mobile/otp/verify` `{ "idToken": "..." }`.

To enable Firebase in a **development build** (not Expo Go):

1. `npx expo install @react-native-firebase/app @react-native-firebase/auth`
2. Add the `@react-native-firebase/app` config plugin to `app.json` with your `googleServicesFile` / `GoogleServiceFile` paths.
3. Place `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) in the mobile project — **do not commit** production secrets to git.
4. Rebuild with EAS or `npx expo run:ios|android`.

If native Firebase modules or config files are missing, sign-up falls back with a clear error (`auth.firebaseStartFailed`).
