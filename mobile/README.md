# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Google Maps keys

Maps use Google Maps Platform (not OpenStreetMap). Configure three separate keys; never commit them.

| Variable | Where to set |
| --- | --- |
| `VITE_GOOGLE_MAPS_BROWSER_KEY` | Vercel (web app) and local root `.env` |
| `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | EAS secrets / local `mobile/.env` for **web export** and Expo web dev |
| `GOOGLE_MAPS_ANDROID_API_KEY` | EAS build env → `mobile/app.config.js` → Android Maps SDK |
| `GOOGLE_MAPS_IOS_API_KEY` | EAS build env → `mobile/app.config.js` → iOS Maps SDK |

Restrict keys in Google Cloud Console:

- **Android**: package `com.famy.app` plus your release/debug signing certificate SHA-1.
- **iOS**: bundle id `com.famy.app`.
- **Browser**: HTTP referrer restrictions for your Vercel domains and local dev origins.

Without keys, the app shows the existing “map unavailable” fallback; address entry still works manually.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **src/app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **example** directory and create a blank **src/app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Test APK from GitHub Actions

The **Mobile preview APK** workflow (`.github/workflows/mobile-apk.yml`) can build installable Android APKs without a developer machine.

1. In GitHub: **Actions → Mobile preview APK → Run workflow**.
2. Choose the **EAS build profile** (`preview` or `development`).
3. Leave **runner** at **`github`** (default) to build on the GitHub Actions runner with `eas build --local`. This uses the same EAS signing credentials and project environment as cloud builds, but does not consume the EAS cloud build quota.
4. Pick the branch or tag to build from, then run the workflow.
5. When the job finishes, open the workflow run’s **Artifacts** section and download `famy-android-<profile>-<short-sha>.apk`.

Use **runner `eas-cloud`** only if you prefer the previous behavior (queued EAS cloud build; link on expo.dev when it completes).

The repository needs the **`EXPO_TOKEN`** Actions secret (Expo access token). Map API keys and `google-services.json` remain configured in EAS, not in the repo.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
