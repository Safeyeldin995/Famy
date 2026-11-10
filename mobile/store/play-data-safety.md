# Google Play — Data safety (draft)

Complete the [Data safety form](https://support.google.com/googleplay/android-developer/answer/10787469) in Play Console. This draft reflects **current mobile + backend behavior** as of the store-readiness pass. Adjust if server collection changes.

## Summary for users

- Data is **collected** to run accounts, bookings, payments, chat, and provider verification  
- Data is **not sold**  
- **Encryption in transit**: HTTPS to Famy APIs and Supabase  
- **Deletion**: in-app account deletion flow + https://famy-chi.vercel.app/account/delete  

## Data types

| Data type | Collected? | Shared? | Purpose | Optional? |
| --- | --- | --- | --- | --- |
| **Name** | Yes | With matched provider/customer for bookings | Account, bookings, chat | Required for account |
| **Phone number** | Yes | With counterparty for active bookings | Auth (OTP), contact | Required |
| **Email** | If OAuth / profile | As needed for auth | Sign-in | Optional (phone auth available) |
| **User IDs** | Yes | No (internal) | Account | Required |
| **Address** | Yes | With provider for service | Booking fulfillment | Required for booking |
| **Precise location (lat/long)** | Yes — whenever a service address is saved (GPS **or** manual pin on the map) | No (third parties) | App functionality: save service address, map pin, booking fulfillment | **Required** to save a service address (valid coordinates on submit) |
| **Photos** | Yes (user uploads) | Stored on Famy; admins/providers per policy | Profile, payment proof, provider ID docs | Optional except where required |
| **Other documents** | Yes (providers / payment PDFs) | Reviewed per policy | Verification, payment proof | Context-dependent |
| **Calendar / booking info** | Yes | Between customer and provider | Service scheduling | Required for bookings |
| **Messages** | Yes | Between booking parties | Chat | Optional |
| **Purchase history** | Yes (booking payments) | Payment processors (e.g. Paymob) | Payments, support | Required for paid bookings |
| **App interactions** | Yes | No | Notifications preferences, booking state | Mixed |
| **Device or other IDs** | Push token | Push infrastructure | Notifications | Optional (push opt-in) |
| **Crash logs** | Not explicitly integrated in mobile app reviewed | — | — | — |
| **Payment card numbers** | **No in app** | Entered on Paymob hosted flow when paying online | Online payment | User choice |

### Service address coordinates

- Saving a service address stores **latitude and longitude** for the pinned location, not only a text label.
- Coordinates come from **“use my location”** *or* from **manually moving the pin** on the map (`LocationPicker` → `AddressEditor`); denying GPS does **not** avoid coordinate collection if the user still saves an address.
- **Not collected in the background** — only while the user is actively placing or editing an address (foreground map flow).
- Used for **app functionality** (matching, routing context, booking fulfillment with the saved address).
- **Not shared with third parties** (no ad/analytics location SDK); address details needed for an active booking are shared with the matched provider as part of fulfillment, not sold.

### Family / children

- Customers may enter **family member name, date of birth/age, relationship**, and optional health/access notes for childcare/tutoring bookings.  
- Declared in privacy policy; not used for third-party advertising in the reviewed app.

### Provider verification

- Government **ID images** and related documents uploaded during provider onboarding; visible to authorized Famy staff per product rules (not copied here).

## Security practices (typical answers)

- Data encrypted in transit: **Yes**  
- Users can request deletion: **Yes** (in-app + web URL)  
- Data handled per privacy policy: **Yes** (link in listing)

## Permissions alignment

See [permissions.md](./permissions.md). No background location, camera, or microphone.
