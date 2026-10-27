# Store accounts & EAS submit checklist / حسابات المتاجر وEAS

Use this once Apple Developer / Google Play accounts exist. Do not commit secrets or key files to git.

## English

1. **Google Play Console** — Create the Famy app (`com.famy.app`), complete Play Console account verification, and enable internal testing.
2. **Play service account** — In Google Cloud, create a service account with Play Console API access; download the JSON key and store it outside the repo (for example `mobile/credentials/google-play-submit.json`, gitignored).
3. **EAS Submit (Android)** — Set `submit.production.android.serviceAccountKeyPath` in [eas.json](../../mobile/eas.json) to that JSON path (or use EAS secrets / env vars documented in [Expo submit](https://docs.expo.dev/submit/eas-json/)).
4. **App Store Connect** — Create the Famy iOS app (`com.famy.app`), complete agreements, tax, and banking as required.
5. **App Store Connect API key** — Create an API key in App Store Connect; save the `.p8` file outside git and note **Issuer ID** and **Key ID**.
6. **EAS Submit (iOS)** — Point `submit.production.ios.ascAppId`, `ascApiKeyPath`, `ascApiKeyIssuerId`, and `ascApiKeyId` in [eas.json](../../mobile/eas.json) to the real values (placeholders are intentional until then).
7. **Firebase native files** — Add `google-services.json` and `GoogleService-Info.plist` locally (see [mobile/NATIVE_AUTH.md](../../mobile/NATIVE_AUTH.md)); never commit production Firebase config.
8. **Production build** — Run `eas build --profile production --platform all` (AAB + iOS store build). Confirm `EXPO_PUBLIC_FIREBASE_TEST_MODE` is not set on the production profile (guarded by unit tests).
9. **Dry-run submit** — After credentials are in place: `eas submit --profile production --platform android` and iOS, starting with internal / TestFlight tracks.

## العربية

1. **Google Play Console** — أنشئ تطبيق فامي (`com.famy.app`) وأكمل متطلبات التحقق من الحساب وفعّل الاختبار الداخلي.
2. **حساب خدمة Play** — أنشئ Service Account في Google Cloud مع صلاحية Play Console API؛ حمّل ملف JSON واحفظه خارج Git.
3. **EAS Submit (Android)** — حدّث `serviceAccountKeyPath` في [eas.json](../../mobile/eas.json) لمسار ملف JSON (أو استخدم أسرار EAS).
4. **App Store Connect** — أنشئ تطبيق iOS (`com.famy.app`) وأكمل الاتفاقيات والضرائب والبنوك حسب المطلوب.
5. **مفتاح App Store Connect API** — أنشئ API Key واحفظ ملف `.p8` خارج Git مع **Issuer ID** و**Key ID**.
6. **EAS Submit (iOS)** — استبدل قيم `ascAppId` و`ascApiKeyPath` و`ascApiKeyIssuerId` و`ascApiKeyId` في [eas.json](../../mobile/eas.json).
7. **ملفات Firebase** — أضف `google-services.json` و`GoogleService-Info.plist` محلياً؛ لا ترفع إعدادات الإنتاج على Git.
8. **بناء الإنتاج** — `eas build --profile production --platform all` (AAB + iOS). تأكد أن وضع اختبار Firebase غير مفعّل في profile الإنتاج.
9. **إرسال تجريبي** — بعد الجاهزية: `eas submit --profile production` لكل منصة (internal / TestFlight أولاً).
