# Phase 2A booking and payment verification

Scope: native customer booking, payment, address creation, cancellation and reviews.
Based on `origin/main` at `6abab603fea94c5cc97fdca048cb306544c9d6cb`, following
`handoff/mobile-phase2a:docs/handoffs/codex-mobile-phase2a.md`. No schema or web
application changes; the two web locale files receive additive keys only.

## Reproduce

From `mobile/`:

```powershell
npx tsc --noEmit
npx expo lint
node qa/unit.cjs
$env:EXPO_OFFLINE='1'; $env:CI='1'
npx expo export --platform android --output-dir "$env:TEMP/m-phase2a-android"
npx expo export --platform web --output-dir "$env:TEMP/m-phase2a-web"
node qa/phase2a-web.cjs "$env:TEMP/m-phase2a-web" qa/artifacts/phase2a
node qa/phase1-web.cjs "$env:TEMP/m-phase2a-web" qa/artifacts/phase1-regression
```

Root checks: `node qa/check-ar-tashkeel.mjs`, `npx tsc --noEmit`, and
`npm run test:unit`. The unit run uses at most two workers to avoid the known
worker contention problem; no assertion or test is excluded beyond the existing script.

## Results (2026-10-21)

- Mobile `npx tsc --noEmit`: exit 0.
- Mobile `npx expo lint`: exit 0; 0 errors, 3 pre-existing Fast Refresh warnings
  in `session.tsx` and `Page.tsx`.
- `node qa/unit.cjs`: exit 0; 15 existing checks and 18 Phase 2A assertions passed.
- Offline Android export: exit 0. Offline web export: exit 0.
- Phase 2A intercepted browser run: exit 0; 3 booking scenarios, 1 asserted Paymob
  call, 2 receipt uploads, and 23 Arabic screenshots.
- Phase 1 regression on the final export: exit 0; 22 Arabic screenshots.
- Root `npx tsc --noEmit`: exit 0.
- Tashkeel scan: exit 0; 716 source files, no tashkeel characters.
- Root `npm run test:unit`: exit 0; 242 files passed, 4 skipped; 1,467 tests passed,
  64 skipped; final run 193.46 seconds.
- `git diff --check`: exit 0.

The browser harness serves a local export, intercepts every remote request, and
uses synthetic fixtures only. It verifies the booking RPC arguments, idempotency
key, duration, recipient, requirement selection, server-derived payment amount,
Paymob Authorization header/body, receipt path/metadata, cancellation reason and
note, review mutation and location-backed address creation. It never accesses
live user data, creates a real booking, or moves money.

## Screenshots

All captures are Arabic, 390x844. Git-ignored absolute paths are recorded in
`artifacts/phase2a/screenshots.json`; results are in `verification.json`.

- `hourly-1-service`, `hourly-2-time`, `hourly-3-address-recipient`,
  `hourly-4-review-payment`, `hourly-5-payment`
- `package-1-service`, `package-2-time`, `package-3-address-recipient`,
  `package-4-review-payment`, `package-5-payment`
- `tutoring-1-service`, `tutoring-2-time`, `tutoring-3-address-recipient`,
  `tutoring-4-review-payment`, `tutoring-5-payment`
- `receipt-uploaded`, `cancel-reason`, `cancelled`, `review-form`, `review-saved`,
  `add-address`, `receipt-size-limit`, `pdf-receipt-uploaded`

Each name has a `.png` extension. Phase 1 regression captures are recorded
separately under `artifacts/phase1-regression`.

## Shared helpers and copied functions

Imported pure web modules: `bookingRequest`, `bookingScreens`, `disabledReason`,
`idempotency`, `errors`, `babysittingRecipient` (and `childAgeMonths`),
`servicePackages`, `closedBetaCategories`, `studentEducationProfile`,
`bookingEducationAutofill`, `educationProfileFieldsLogic`, `pending-expiry`,
`address-query-keys`, `latLng`, and `paymobReturnPolling`.
Explicit TypeScript aliases allow the pure modules' transitive `@/lib` imports
without importing the web React application.

Copied instead of imported:

| Function(s) | Source and reason |
| --- | --- |
| `completeCreateBookingResult` | `src/lib/booking/create-booking-result.ts` also contains a web-schema Supabase client factory. Mobile copies the retry/degraded-result function with a local injected fetcher. |
| `planPostCreatePayment`, `isPaymentEligibleBookingStatus` | `src/lib/booking/post-create-payment.ts` also uses browser sessionStorage. Pure decisions are copied; mobile persistence uses AsyncStorage scoped by user and booking. |
| British grade filter | `src/lib/tutoring/teachingLevelFilters.ts` imports types from the web query module. The same g10/g11/g12 filter is copied with a source comment. |
| `toAddressRow` | Mixed `src/lib/db/queries.ts`; preserved legacy line1/line2 derivation and fields. |
| Query/mutation hooks, `fetchProviderBookingSettings` and slot calculation | Mixed web query modules rely on the web Supabase client/auth. `bookingQueries.ts` ports the same RPCs, arguments, table filters, availability boundaries, conflicts and writes to the mobile client. |
| Proof upload operation | Mixed `src/lib/db/payment-queries.ts` takes a browser File. Mobile uses Expo File on native and an ArrayBuffer from the picker asset, preserving bucket/path and metadata-only update, with a 10 MB check before and after reading. |
| Visa/Mastercard shapes | Web DOM SVG is rendered with react-native-svg; the Paymob PNG is copied unchanged. |

The mixed-module query ports are `useCreateAddress`, `useResolveZone`,
`fetchProviderBookingSettings`, `useProviderBookingSettings`, `useAvailableSlots`,
`useCreateBooking`, `useBookingReview`, `useSubmitReview`, `useFixedPackageRate`,
`useCreatePayment`, `useActivePaymentMethods`, `useRequirementsForService`,
`useUpsertCustomerEducationProfile`, `useSaveStudentEducationProfile`, and
`useCancelBooking`. `useBookingConfig`, `validatePromoCode`, and
`useCancellationReasons` wrap the corresponding existing settings read, promo RPC,
and cancellation-reason query for the mobile client. `uploadProof` and `openProof`
port the web upload and signed-URL operations. The source comments in each module
identify the web implementation; none creates a new backend contract.

## Native presentation and limits

The four-screen order and backend rules are preserved. Date/slot selection uses
the web's 14-day grid; family birth dates use a native picker (HTML date picker
in the web export). Add-address/member actions push native screens and return to
the mounted booking draft instead of opening web bottom sheets. Tutoring sessions
are listed as approved subject/duration/price options rather than grouped DOM cards.

Image receipts use expo-image-picker; PDF receipts use expo-document-picker, matching the web accepted formats. Uploaded receipts open a ten-minute signed URL.

Hosted checkout uses `openBrowserAsync`; card data stays outside the app. Return
and foreground events refetch payment/booking, with the shared bounded polling
helper and a manual refresh action. Payment recovery cannot resubmit a booking.
The client never writes captured/paid state or calculates authoritative totals.

No required backend booking path is omitted. Maps, chat, push and OTP remain
outside this phase. Export and intercepted browser tests do not replace physical
device QA for Android/iOS RTL, system permissions, picker behavior, or hosted
checkout return. Claude owns independent review and merge.
