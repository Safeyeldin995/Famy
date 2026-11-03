# Booking crash and family member age

## Follow-up: app-wide plurals (2026-11-03)

Merged `origin/main` at `8805fd9` with merge commit `7d948ad`; retained both test lists and all provider-service-request / booking step-one parity behavior. The DST test has no diff from main.

The duration helper only addressed the immediate render crash. The root fix now installs exact `@formatjs/intl-pluralrules@7.0.2`. `mobile/index.js` loads the conditional polyfill and ar/en data before Expo Router can load i18n or screens. Version 7 exports require the `.js` suffix. Supported native implementations are not force-replaced.

The real mobile i18n initializer is tested with both `Intl.PluralRules` and `Intl.Locale` removed: `providerPage.reviewCount` resolves to `تقييمين` for 2 and `3 تقييمات` for 3; English singular/plural also pass. Current app languages are exactly `ar` and `en`. The existing duration helper remains.

Scan of all `mobile/src` and `src/lib`: no `RelativeTimeFormat`, `ListFormat`, or `DisplayNames` uses. Existing NumberFormat and DateTimeFormat uses remain; shared `src/lib/format/index.ts` also uses PluralRules, now covered by the entry polyfill if imported by mobile.

Current follow-up verification (all exit 0):

- Mobile typecheck; 12 Vitest files / 55 tests; ESLint on changed source files.
- Root typecheck; 8 focused Vitest files / 35 tests, including the fixed DST tests.
- Mobile web export; full `phase2a-web.cjs`: 23 Arabic screenshots, hourly/package/tutoring, cash/transfer/Paymob, receipt/cancellation/review/address flows.
- Focused `booking-age` harness: creation → detail with PluralRules removed before startup, plus estimated member-age save.

The newly merged crypto guard test needed Windows path-separator normalization because it otherwise scanned its own test string. No production guard was weakened. Migration remains unapplied; native post-fix EAS verification remains pending. The initial-run results below are historical, not the follow-up gate results.

CI's root Vitest job includes mobile tests. It now installs the locked mobile dependencies before testing, so the real polyfill imports resolve on clean CI runners; no tests were excluded or mocked to bypass the package.

## Android crash evidence

On `Medium_Phone_API_37.0`, cleared logcat and opened the existing pending full-day babysitting booking in the installed preview APK. The app immediately exited to the launcher. No duplicate live booking was created for reproduction.

Raw local capture: `D:\DevTools\logs\booking-crash.txt` (not committed). The complete sanitized fatal/component/JS/Java stack is in [booking-crash-stack.txt](booking-crash-stack.txt).

The fatal exception is `JavascriptException: TypeError: undefined cannot be used as a constructor`, originating in `BookingDetail`. The detail screen directly constructed `Intl.PluralRules`, which is absent in this Android runtime. Replaced that render-time constructor with a pure duration-unit helper and explicit translation keys. This does not change booking creation, prices, payments, or navigation; no render error suppression was added.

The regression harness creates a fixed 8-hour booking using isolated local fixtures, follows the success navigation, and renders the pending detail screen after removing `Intl.PluralRules`. It also saves an infant's estimated age and checks the saved flag. No live backend writes are used by the harness.

**Native post-fix verification is pending a new EAS APK.** The installed old APK still reproduces the crash; the fixed web-export regression is not presented as a native release test. After the migration is reviewed/deployed, build this branch's preview APK and recheck opening/creating a full-day booking.

## Age behavior and deployment

- Same age model on web/native: children 0–17, other relationships 0–99; months 0–11 shown only for years 0 or 1.
- Uses Cairo's calendar date and stores a first-of-month estimate. New/edited age-picker submissions set `date_of_birth_is_estimated=true`.
- Existing rows keep their DOB; the migration only adds the flag, default false. Existing booking snapshots and babysitting eligibility calculations remain unchanged.
- Member lists, booking choices, provider cards/details, and admin booking detail show age rather than DOB. Under-twos show total months.
- `20261102141426_family_member_estimated_birth_date.sql` is **review-only and unapplied**. Apply it before deploying clients. It also adds `booking_party_profiles_with_member_age`, an additive wrapper of the unchanged party-checked RPC, returning months with the same access/status gates and never returning DOB.
- No Production migration or data changes were made.

## Screenshots (Arabic, 390×844, local fixtures)

| Screen                                           | Evidence                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Web member age form: 1 year, 8 months            | [member-form-web.png](screenshots/member-form-web.png)                         |
| Native components in mobile web export: same age | [member-form-mobile.png](screenshots/member-form-mobile.png)                   |
| Booking detail immediately after local creation  | [booking-detail-after-create.png](screenshots/booking-detail-after-create.png) |

Additional screenshots cover all four booking steps and payment detail. `screenshots/verification.json` records the focused harness assertions.

## Verification

- Mobile `npx tsc --noEmit`: PASS (exit 0).
- Mobile `npx vitest run`: PASS, 10 files / 52 tests.
- Root `npx tsc --noEmit`: PASS (exit 0).
- Focused root tests (age conversion, form/serialization, booking flow, provider card, party queries, PGlite migration privacy): PASS, 7 files / 31 tests.
- Root full `npx vitest run --maxWorkers=2`: exit 1; 269 files passed, 1 failed, 7 skipped; 1,594 tests passed, 2 failed, 75 skipped. Both failures are in unchanged `booking-midnight-cairo-dst.test.ts`: its fixed 2026-10-29 fall-back booking is now in the past and fails minimum-notice validation. No unrelated test changes made.
- `npm run build`: PASS (exit 0).
- Mobile `npx expo export --platform web --output-dir dist-booking-age`: PASS (exit 0).
- `node qa/phase2a-web.cjs dist-booking-age qa/booking-crash-member-age/screenshots booking-age` from mobile: PASS (exit 0).
- `node mobile/qa/booking-crash-member-age/web-member.mjs`: PASS (exit 0), using preview-only Vite on port 4321 with local dummy backend configuration.
- `node qa/check-ar-tashkeel.mjs`: PASS, 769 source files.
- Mobile `npx expo lint`: exit 1, 22,686 errors / 12 warnings, overwhelmingly existing CRLF formatting errors across the checkout. Separate ESLint run on every changed/new mobile source file: PASS (exit 0). Unrelated files were not reformatted.
- Independent review: no open BLOCKER/HIGH findings.

No dependency changes, credentials, raw logs, or private customer details are included.
