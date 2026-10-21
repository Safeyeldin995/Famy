# Customer mobile UI polish

Arabic Expo web screenshots at 390 × 844, captured on 2026-10-21 with the existing Playwright harnesses and isolated synthetic fixtures. All remote traffic was intercepted. No production data or writes were used. Android was verified by an offline export; these are web-rendered screenshots, not Android device captures.

Baseline: `86e966e` (latest origin/main when this branch was created). After: the final visual source in this PR.

| Screen | Baseline | Updated |
| --- | --- | --- |
| home | [Before](before/home.png) | [After](after/home.png) |
| search | [Before](before/search.png) | [After](after/search.png) |
| provider | [Before](before/provider.png) | [After](after/provider.png) |
| bookings | [Before](before/bookings.png) | [After](after/bookings.png) |
| booking-detail | [Before](before/booking-detail.png) | [After](after/booking-detail.png) |
| hourly-1-service | [Before](before/hourly-1-service.png) | [After](after/hourly-1-service.png) |
| hourly-2-time | [Before](before/hourly-2-time.png) | [After](after/hourly-2-time.png) |
| hourly-3-address-recipient | [Before](before/hourly-3-address-recipient.png) | [After](after/hourly-3-address-recipient.png) |
| hourly-4-review-payment | [Before](before/hourly-4-review-payment.png) | [After](after/hourly-4-review-payment.png) |
| tutoring-4-review-payment | [Before](before/tutoring-4-review-payment.png) | [After](after/tutoring-4-review-payment.png) |

## Scope and verification

Shared cards, spacing, headers, press feedback and icon empty states; RTL customer layouts; larger booking options; a four-step progress indicator; fixed price/action footer; aligned price breakdown. All booking handlers, queries, quote arithmetic, validation, and submission logic were preserved. The wizard logic before its first JSX fragment was checked byte-for-byte against the base revision.

- Mobile `npx tsc --noEmit`: exit 0.
- Mobile `npx expo lint`: exit 0, 0 errors, 4 existing Fast Refresh warnings.
- Mobile `node qa/unit.cjs`: exit 0, 15 core checks and 21 Phase 2A assertions.
- Offline web and Android exports: exit 0 (`EXPO_OFFLINE=1`).
- Root `npx tsc --noEmit`: exit 0.
- Root `node qa/check-ar-tashkeel.mjs`: exit 0, 716 source files, no diacritics.

The browser harness commands are run from `mobile/`, with `dist-polish-after` as the web export and a separate output directory per harness:

```sh
node qa/phase1-web.cjs dist-polish-after qa/artifacts/ui-polish/after/phase1
node qa/phase2a-web.cjs dist-polish-after qa/artifacts/ui-polish/after/phase2a
node qa/provider-web.cjs dist-polish-after qa/artifacts/ui-polish/after/provider
node qa/provider2-web.cjs dist-polish-after qa/artifacts/ui-polish/after/provider2
node qa/chat-web.cjs dist-polish-after qa/artifacts/ui-polish/after/chat
```

## Harness corrections

The untouched baseline export exposed missing current-app fixtures: `conversations` in the two customer harnesses, and `provider_documents` in the first provider harness. Added empty local fixtures only; no assertions or error checks were removed or weakened. The dedicated chat and provider-document harnesses still exercise populated flows.

Expo lint initially reported CRLF-only errors in unchanged files. Their local worktree bytes were normalized to the identical LF blobs in Git for lint, without changing tracked source or lint rules. No excluded files are included in the PR.

All five final browser harnesses exited 0: phase1 (22 screenshots), phase2a (23), provider (11), provider2 (6), and chat (6). See `checks.json`.
