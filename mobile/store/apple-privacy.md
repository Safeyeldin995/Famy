# Apple App Privacy (draft labels)

Use this when completing **App Privacy** in App Store Connect. Canonical store copy lives under `mobile/store/`; update here when mobile collection changes.

## Data linked to the user

| Category | Examples | Purpose | Third parties |
| --- | --- | --- | --- |
| Contact info | Name, phone | Account, bookings, OTP sign-in | Firebase Auth (phone), Supabase |
| Location | Precise coordinates on saved service addresses | Booking fulfillment | Supabase (not sold) |
| User content | Profile photo, chat, booking notes, payment proof, provider ID docs | App functionality | Supabase storage |
| Financial info | Booking payment history (not card numbers in-app) | Payments | Paymob (hosted checkout) |
| Health & fitness | Optional allergies / medical notes for family members | Childcare booking context | Supabase |
| Audio / video | Live lesson camera and microphone streams | Online lessons | LiveKit (ephemeral, not recorded) |
| Diagnostics | Crash and performance data | App stability | Sentry |
| Identifiers | User id, push token | Account, notifications | Supabase, Expo push |

## Data not linked

- Anonymous analytics is not used in the reviewed mobile build beyond optional Sentry diagnostics tied to the authenticated session.

## Tracking

- **No** cross-app tracking for advertising in the reviewed build.

## Account deletion

- In-app deletion for customers and providers; web flow at https://famy-chi.vercel.app/account/delete

## Sign-in

- Existing customers: **phone number + password** (OTP only for sign-up and password reset).  
- **Sign in with Apple** where required on iOS when other third-party sign-in is offered.