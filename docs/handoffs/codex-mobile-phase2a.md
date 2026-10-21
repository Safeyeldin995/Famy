Claude (lead engineer) reviewed and merged Phase 1 (PR #186). Good work. Next is **Phase 2A: booking and payment in the native app**.

## Before you start
1. `git fetch origin && git checkout -b feat/mobile-phase2a origin/main`
2. Read `AGENTS.md`, `mobile/AGENTS.md`, and your Phase 1 code. Every Phase 1 rule still applies:
   - same Supabase project and RLS;
   - use `@shared/*` only for pure modules;
   - every string goes through `t()`, in both `ar` and `en`, with no tashkeel;
   - RTL-safe styles; 44px tap targets;
   - loading, empty and error states;
   - no fake business data.
3. Claude is adding a stable endpoint for Paymob: `POST {webOrigin}/api/mobile/paymob-checkout`.
   - Headers: `Authorization: Bearer <supabase access_token>`, `Content-Type: application/json`.
   - Body: `{ "bookingId": uuid, "paymentId"?: uuid }`.
   - Returns `{ ok: true, checkoutUrl, paymentId }`, or `{ ok: false, error }` with status 401, 400 or 500.
   
   If it isn't on `main` when you start, code against this contract anyway.

## Scope
1. **Booking wizard.** Port `src/routes/book.$providerId.tsx` faithfully into `mobile/src/app/(customer)/book/[providerId].tsx`, in the same order, with the same rules and the same validations. It covers:
   - babysitting by the hour, with the 2–8 hour stepper;
   - fixed packages;
   - tutoring: curriculum/level, capability matching and session pricing;
   - the recipient/family member;
   - address;
   - date and time slots from the same availability RPCs and helpers;
   - notes;
   - promo code;
   - price summary;
   - payment method choice.
   
   Replace the Phase 1 "booking coming soon" screen and route the provider screen's "Book" button here.
   - Reuse pure helpers from the web through `@shared/*`. Open each import in `book.$providerId.tsx`. If it's pure, import it. If it's mixed, copy only the pure function and add a one-line source comment.
   - Use the same booking-creation call the web uses (its RPC or insert and its arguments). **Do not** invent a new path.
   - Dates and times: use native pickers (`@react-native-community/datetimepicker` via `EXPO_OFFLINE=1 npx expo install`) or the same slot grid the web shows. No free-text dates.
   - Also fix Phase 1's family-member birth date field to use a native date picker.
2. **Payment after creation.** Port the web logic in `src/lib/booking/post-create-payment.ts` and `src/components/famio/PaymentBlock.tsx` (customer side only):
   - **Cash:** confirm and show the next steps.
   - **InstaPay (manual_transfer):** show the receiver handle and note from the method snapshot, with a copy button. Let the customer upload a receipt with `expo-image-picker`, through the same storage bucket, path rules and mutation as the web `useUploadPaymentProof`. Keep the 10 MB limit.
   - **Paymob (online):** call the endpoint above with the current session's access token, then open `checkoutUrl` with `WebBrowser.openAuthSessionAsync`, or `openBrowserAsync` if that's simpler. When it returns, refetch the booking and payment and show the status. Never handle card data in the app.
   - Show the payment logos next to the methods: Paymob, Visa and Mastercard for online. Copy the PNG and SVG shapes from `src/components/famio/PaymentLogos.tsx` and `src/assets/payment/paymob.png` into the mobile assets. Use `react-native-svg` for Visa and Mastercard.
3. **Add address.** Build a native address form with the same fields and validation as the web `AddressForm`. Add a "use my current location" button (`expo-location`, with the permission prompt text in both languages) that fills the coordinates. Area selection comes from `settings.service_areas`. **No map yet**: Android maps need an API key that the Product Owner hasn't created.
4. **Booking detail actions.** Port the customer actions from `src/routes/booking.$id.tsx`:
   - cancel, with reasons from `cancellation_reasons` and the same RPC;
   - rate and review after completion, using the same mutation;
   - "book again".
   
   Keep every rule the web enforces, such as cancellation windows and who can do what.

## Out of scope
- Chat, push notifications, the sign-up/reset OTP, the provider app and the admin.
- Any change under `src/` other than i18n keys.
- Any migration.
- Never mark a payment as paid from the client. Never touch commission or prices.

## Verify (all must pass)
From `mobile/`:
- `npx tsc --noEmit`
- `npx expo lint` (0 errors)
- `node qa/unit.cjs`: extend it for the pure booking and pricing helpers you used.
- `EXPO_OFFLINE=1 CI=1 npx expo export --platform android` and the same for `--platform web`
- Extend `qa/phase1-web.cjs` (or add `qa/phase2a-web.cjs`) with intercepted fixtures. It must cover:
  - the full wizard for babysitting hourly, a package, and tutoring;
  - each payment method;
  - receipt upload;
  - the Paymob call: assert the Authorization header and body; a fake `checkoutUrl` is fine;
  - cancel and review.
  
  Take 390×844 Arabic screenshots of every step.

From the repo root:
- `node qa/check-ar-tashkeel.mjs`
- `npx tsc --noEmit`
- `npm run test:unit`

## Deliver
- Push `feat/mobile-phase2a` and open a **Draft PR** titled "feat(mobile): phase 2A booking and payments".
- Never push to `main`, never force-push, never merge, never print secrets.
- Report:
  - the PR link and HEAD SHA;
  - the exact results of each check;
  - the screenshot list;
  - every web helper you copied instead of importing, and why;
  - anything in the web booking flow you could not reproduce faithfully.
