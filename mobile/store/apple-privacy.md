# Apple App Privacy (draft labels)

Use this when completing **App Privacy** in App Store Connect. Canonical store copy lives under `mobile/store/`; update here when mobile collection changes.

## Data linked to the user

| Category | Examples | Purpose | Third parties |
| --- | --- | --- | --- |
| Contact info | Name, phone, email (profile or OAuth), parent or guardian phone and email for students aged 12–17 | Account, bookings, OTP sign-in, guardian contact | Firebase Auth (phone), Supabase |
| Contact info | Date of birth (students 12–17 and online-lesson eligibility) | Age eligibility | Supabase |
| Location | Precise coordinates on saved service addresses | Booking fulfillment | Supabase (not sold) |
| User content | Profile photo, chat, booking notes, payment proof, provider ID docs | App functionality | Supabase storage |
| Financial info | Booking payment history (not card numbers in-app) | Payments | Paymob (hosted checkout) |
| Health & fitness | Optional allergies / medical notes for family members | Childcare booking context | Supabase |
| Audio / video | Live lesson camera and microphone streams | Online lessons | LiveKit (ephemeral, not recorded) |
| Diagnostics | Crash and performance data | App stability | Sentry |
| Identifiers | User id, push token | Account, notifications | Supabase, Expo push |
| Usage Data | Product interaction (Firebase Analytics events such as booking_started) | Product analytics, not ads | Google (Firebase Analytics) |

## Data not linked

- Firebase Analytics events are not used for cross-app advertising. Advertising ID collection is disabled in the reviewed build.

## Tracking

- **No** cross-app tracking for advertising in the reviewed build.

## Account deletion

- In-app deletion for customers and providers; web flow at https://famy-chi.vercel.app/account/delete

## Sign-in

- Existing customers: **phone number + password** (OTP only for sign-up and password reset).  
- **Sign in with Apple** where required on iOS when other third-party sign-in is offered.