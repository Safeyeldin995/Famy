# Investor demo screenshots (PR #391)

Captured on **Expo web export** at **390×844**, Arabic locale, isolated fixtures (no production data). **1.2× font scale is not simulated on web**; Android caps are covered by `textFontScaleCap.test.ts` (`maxFontSizeMultiplier` 1.2).

## Before (merge-base `f956358`, pre–investor-polish)

| Screen | File |
| --- | --- |
| Sign-in | [sign-in.png](before/sign-in.png) |
| Profile | [profile.png](before/profile.png) |
| Provider wallet (earnings) | [pro-earnings.png](before/pro-earnings.png) |
| Home / bookings / etc. | [before/](before/) (Oct 2025 baseline set) |

Baseline captures: `node qa/capture-missing-before.cjs <export> qa/ui-polish-evidence/before` and `node qa/provider-web.cjs <export> …` on `dist-baseline-before`.

## After (this branch)

| Screen | File |
| --- | --- |
| Home | [home.png](after-investor-demo/home.png) |
| Bookings | [bookings.png](after-investor-demo/bookings.png) |
| Booking detail | [booking-detail.png](after-investor-demo/booking-detail.png) |
| Profile | [profile.png](after-investor-demo/profile.png) |
| Sign-in | [sign-in.png](after-investor-demo/sign-in.png) |
| Booking / payment | [phase2a/hourly-4-review-payment.png](after-investor-demo/phase2a/hourly-4-review-payment.png) |
| Provider wallet | [provider-wallet/pro-earnings.png](after-investor-demo/provider-wallet/pro-earnings.png) |

```sh
cd mobile
npx expo export --platform web --output-dir dist-investor-demo
node qa/phase1-web.cjs dist-investor-demo qa/ui-polish-evidence/after-investor-demo
EXPO_PUBLIC_DEMO_PAYMENTS=1 node qa/phase2a-web.cjs dist-investor-demo qa/ui-polish-evidence/after-investor-demo/phase2a
node qa/provider-web.cjs dist-investor-demo qa/ui-polish-evidence/after-investor-demo/provider-wallet
```

## Screen inventory & bottom padding

- [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md)
- [SELF_SCROLL_BOTTOM_PADDING.md](SELF_SCROLL_BOTTOM_PADDING.md)

## Home freeze evidence

See [../HOME_FREEZE.md](../HOME_FREEZE.md) and `home-freeze-diag-*.json`.