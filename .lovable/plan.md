# Auth Overhaul

Three changes layered onto the existing phone-OTP flow.

## 1. Signup screen — Customer vs Provider

Replace the current single phone-entry screen with a two-tab layout:

```text
┌───────── Famio ─────────┐
│  [ Sign in ] [ Sign up ]│
│                          │
│  I am a:                 │
│  ( ) Customer            │
│  ( ) Service Provider    │
│                          │
│  Phone: +20 ___________  │
│  [ Continue ]            │
└──────────────────────────┘
```

- Customer → OTP → set password → `/setup` → `/home`.
- Provider → OTP → set password → `/pro/onboarding` (document upload, services, etc.). Provider stays `is_verified = false` until an admin approves them in the Admin Portal; until then their profile is hidden from customer search (existing behavior is preserved).
- The role chosen at signup is written into `user_roles` so `/home` auto-redirects providers to `/pro` on every future login.

## 2. Returning sign-in — phone + password

- Default login is **phone + password** (replaces OTP for repeat logins).
- Server function `signInWithPassword` looks up the synthetic email (`phone-{digits}@famio.local`, already in use) and calls Supabase password sign-in.
- Wrong password → inline error, no OTP fallback.
- "Forgot password?" link → triggers OTP → after verify, user sets a new password → signed in.

## 3. Password setup screen

New screen `/auth/set-password` shown:
- Once at end of signup, after OTP verified.
- Again during forgot-password flow, after OTP verified.

Validates: min 8 chars, at least one letter and one number. Single field + show/hide toggle (no confusion from "confirm password" on mobile).

## Technical changes

**Server (`src/lib/otp.functions.ts`)**
- `sendOtp(phone, purpose)` — `purpose` is `signup | reset`. For `signup`, errors if phone already has an account. For `reset`, errors if it doesn't.
- `verifyOtpForSignup(phone, code, role)` — verifies, creates `auth.users` row via Admin API, assigns role in `user_roles` (overrides the trigger's default `customer` when `provider` selected), returns short-lived session.
- `verifyOtpForReset(phone, code)` — verifies, returns a one-time token used by `setPassword`.
- `setPassword(token, newPassword)` — updates the user's password via Admin API, signs them in.
- New: `signInWithPassword(phone, password)` — thin wrapper, returns session or `invalid_credentials`.

**Client routes**
- `src/routes/login.tsx` — rewritten as tabbed Sign in / Sign up with role radio on Sign up.
- `src/routes/otp.tsx` — accepts `purpose` query param; routes to `/auth/set-password` instead of straight into the app.
- `src/routes/auth.set-password.tsx` — new.
- `src/routes/auth.forgot.tsx` — new, just a phone-entry screen for reset.
- Splash `src/routes/index.tsx` — keeps current "if authed → home" behavior; no change needed because Supabase already persists the session in `localStorage`. (If you've been re-entering credentials every launch, that's because each preview rebuild gives a new origin; on the published `famio-trusted-home.lovable.app` URL the session persists across launches.)

**i18n**
- New keys in `en.ts` / `ar.ts` for: Sign in, Sign up, I am a, Customer, Service Provider, Password, Forgot password, Set a password, Password requirements, Wrong password.

**No schema changes.** Roles, providers, and verification tables already exist. The provider-approval gate (`providers.is_verified` + admin queue) is already wired — no new SQL.

## Out of scope

- Biometric unlock (you said skip until Capacitor wrap).
- Google sign-in (not requested).
- Email-based auth (phone remains the identifier).

Approve and I'll build it in one pass.
