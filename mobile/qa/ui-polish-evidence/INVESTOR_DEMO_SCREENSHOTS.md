# Investor demo screenshots (PR #391)

Captured on **Expo web export** at **390×844**, Arabic locale, isolated fixtures (no production data). Same harnesses as `mobile/qa/PHASE2A.md`.

## After (this branch)

| Screen | Normal | 1.2× font (web `html` scale) |
| --- | --- | --- |
| Home | [home.png](after-investor-demo/home.png) | [home-font-1.2.png](after-investor-demo/home-font-1.2.png) |
| Bookings | [bookings.png](after-investor-demo/bookings.png) | [bookings-font-1.2.png](after-investor-demo/bookings-font-1.2.png) |
| Booking detail | [booking-detail.png](after-investor-demo/booking-detail.png) | [booking-detail-font-1.2.png](after-investor-demo/booking-detail-font-1.2.png) |
| Profile | [profile.png](after-investor-demo/profile.png) | [profile-font-1.2.png](after-investor-demo/profile-font-1.2.png) |
| Sign-in | [sign-in.png](after-investor-demo/sign-in.png) | [sign-in-font-1.2.png](after-investor-demo/sign-in-font-1.2.png) |
| Booking / payment | [phase2a/hourly-4-review-payment.png](after-investor-demo/phase2a/hourly-4-review-payment.png) | (phase2a harness; 1× only) |
| Provider wallet | [provider-wallet/pro-earnings.png](after-investor-demo/provider-wallet/pro-earnings.png) | — |

Commands used:

```sh
cd mobile
npx expo export --platform web --output-dir dist-investor-demo
node qa/phase1-web.cjs dist-investor-demo qa/ui-polish-evidence/after-investor-demo
EXPO_PUBLIC_DEMO_PAYMENTS=1 node qa/phase2a-web.cjs dist-investor-demo qa/ui-polish-evidence/after-investor-demo/phase2a
```

## Before (baseline on `main`, prior polish branch)

See [before/](before/) for home, bookings, booking-detail, profile, booking payment step.

## Screen inventory

See [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md).

## Home freeze evidence

See [../HOME_FREEZE.md](../HOME_FREEZE.md).