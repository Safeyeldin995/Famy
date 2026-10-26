# Mobile/web parity — work in progress

**This branch does not complete screen-by-screen parity. Do not merge it as a completed parity release.**

Base: `6c2fbfa`. Screens are captured at 390 × 844 in Arabic. Each comparison has web on the left and the actual Expo React Native Web export on the right. These are not recreated HTML mockups of native screens.

## Implemented

- Native onboarding: the three original PNGs (byte-identical), shared web translations, wordmark, language toggle, Skip, dots, page counter, Next/Start, and safe-area spacing.
- First signed-out entry reads AsyncStorage `onboarded`; Skip/Start persists completion and opens login. Signed-in workspace routing is preserved. Storage failure does not trap the user.
- Home: web-style horizontal promo strip with copy feedback; 160px service tiles; customer floating RTL navigation bar and selected-icon pill.
- Addresses, family, notifications: ported web page headers. Favorites, help, promos: ported web hero headers. Favorites has the web empty-state text/icon/browse action.
- All protected files listed in the task are unchanged, including `mobile/qa/*.cjs`. The nested capture runner reads those existing fixtures without modifying them.

## Evidence limits

- Web runs through `npm run dev` and existing `/preview` routes. Native runs the exported application using existing synthetic fixtures. All external browser requests are intercepted/blocked. Google Fonts CSS is fulfilled locally using the installed copies of Almarai/Manrope.
- Preview-only web hub links/banner are removed from screenshots; application elements are not removed. Captures wait for hydration and the native launch overlay.
- Fixture records differ between platforms (names, prices, counts, services). These images expose layout differences; they are **not** a pixel equality test or proof of equal backend behavior.
- No real login, SMS, customer/provider data, migration, payment, or production write occurred. Android export is not Android-device interaction evidence.
- Missing comparisons below are explicitly unverified, not passed. Provider ports and remaining screen bodies are unfinished implementation, not blocked by permissions.

## Screen matrix

“Yes” means the requested onboarding port/flow was implemented and exercised. “No” includes partially changed screens whose complete parity is still open.

| Screen | Differences found / remaining work | Fixed (yes/no) | Evidence |
| --- | --- | --- | --- |
| Onboarding, three slides | Previously absent; same images/copy/controls now ported; persistence/Skip/return visit tested | Yes | [1](comparisons/onboarding.png), [2](comparisons/onboarding-2.png), [3](comparisons/onboarding-3.png) |
| Customer home | Promo strip, tile size and nav improved; nearby/rebook/trust presentation and fixture normalization still differ | No | [Pair](comparisons/home.png) |
| Search | Filter controls, spacing and provider result rows need port | No | [Pair](comparisons/search.png) |
| Babysitting category | Header, filters, provider rows differ | No | [Pair](comparisons/category-babysitting.png) |
| Tutoring category | Header, filters, provider rows differ | No | [Pair](comparisons/category-tutoring.png) |
| Provider public profile | Native hero/card, service rows, stats, teaching information and sticky booking action differ | No | [Pair](comparisons/provider.png) |
| Booking step 1 | Native progress strip and separate duration box differ from web provider summary/service cards | No | [Pair](comparisons/booking-step-1.png) |
| Booking step 2 | Native captured; interactive web date/slot state not captured for same fixture | No | Native fixture capture only |
| Booking step 3 | Native captured; matching web address/recipient state not captured | No | Native fixture capture only |
| Booking step 4 | Native captured; matching web review/payment state not captured | No | Native fixture capture only |
| Package/tutoring booking variants | Existing isolated native scenarios pass; cross-platform layout comparison incomplete | No | Native fixture capture only |
| Customer bookings | Navigation improved; status tabs/list cards remain different | No | [Pair](comparisons/bookings.png) |
| Customer booking detail | Timeline/actions/card hierarchy not ported | No | [Pair](comparisons/booking-detail.png) |
| Customer messages | List/row/header presentation remains different | No | [Pair](comparisons/messages.png) |
| Customer chat | Composer/bubble/header layout requires reconciliation | No | [Pair](comparisons/chat.png) |
| Customer notifications | Header/mark-all placement ported; grouping, date labels and row styling remain | No | [Pair](comparisons/notifications.png) |
| Customer profile | Navigation improved; account hero/menu structure still differs | No | [Pair](comparisons/profile.png) |
| Addresses | Header ported; card actions/add placement remain different | No | [Pair](comparisons/addresses.png) |
| Address creation | Native captured; matching web form state not captured | No | Native fixture capture only |
| Family members | Header/privacy copy ported; row avatar/actions/add placement still differ | No | [Pair](comparisons/family-members.png) |
| Family member creation | Form control layout/date input remains different | No | [Pair](comparisons/family-member-new.png) |
| Family member edit | Native captured; paired edit state not captured | No | Native fixture capture only |
| Favorites | Hero and empty state ported; populated row needs web ProviderListRow port | No | [Pair](comparisons/favorites.png) |
| Promo codes | Hero ported; available and redeemed promo card bodies remain different | No | [Pair](comparisons/promo-codes.png) |
| Help | Hero ported; contact/FAQ presentation still differs | No | [Pair](comparisons/help.png) |
| Terms/privacy | Native fixture captures exist; web has no corresponding preview route captured here | No | No valid pair |
| Delete account | Web preview captured; native destructive flow not exercised by existing fixture suite | No | No valid pair |
| Provider dashboard | Header, metrics label, booking cards, upcoming row and navigation differ | No | [Pair](comparisons/dashboard.png) |
| Provider jobs | Header, filters, request cards and navigation differ | No | [Pair](comparisons/jobs.png) |
| Provider schedule | Native uses increment controls; web uses time selectors; vacation list/card layout differs | No | [Pair](comparisons/schedule.png) |
| Provider earnings | Metrics/labels/sections/date presentation differ | No | [Pair](comparisons/earnings.png) |
| Provider messages/chat | Native fixtures captured; matching provider web preview route not available in the registry used here | No | No valid pair |
| Provider profile | Status/menu/service readiness layout differs | No | [Pair](comparisons/pro-profile.png) |
| Provider profile edit | Native captured; corresponding editable web state not captured | No | No valid pair |
| Provider documents | Native upload/list layout differs from web review statuses | No | [Pair](comparisons/pro-documents.png) |
| Provider application (3 native steps) | Native fixtures captured; web setup structure differs | No | No valid pair |
| Provider setup home | Web pending preview captured; matching native setup-home fixture not captured | No | No valid pair |
| Provider setup photo/about/babysitting/subjects/reference/personal/hours | Web preview captured per section; native paired fixtures/ports still needed | No | No valid pairs |
| Provider notifications | Grouped web list vs native cards/date labels | No | [Pair](comparisons/pro-notifications.png) |

## Checks

- `cd mobile && npx tsc --noEmit`: exit 0.
- `cd mobile && npx expo export --platform android --output-dir dist-parity-android`: exit 0.
- `cd mobile && npx expo export --platform web --output-dir dist-parity`: exit 0.
- `node qa/check-ar-tashkeel.mjs`: exit 0, 756 source files checked.
- Existing `mobile/qa/unit.cjs`: exit 0 (validation/matching/locales, booking/payload/gates, deep links/OAuth, OTP input state machine).
- `onboarding-test.mjs`: exit 0, persistence and failed storage adapter, three slides, completion, return visit, Skip.
- Existing isolated browser fixtures: customer 22 captures, provider 13, provider setup/documents 6, chat 6, booking 23; all fixture checks passed. Initial booking browser process crashed; sequential rerun passed. No real-device parity claim.
- Initial root TypeScript invocation used the root compiler and reported shared timer typing errors; the required invocation from `mobile/` with its locked compiler passes. No shared payment file was changed.
- Root dependency install reported two high dependency findings; no lockfile/dependency changes were made in this UI task.

## Reproduction

From repository root: start `npm run dev -- --host 127.0.0.1 --port 5173` with `PREVIEW_ROUTES_ENABLED=true` and local-only placeholder Supabase settings. Do not use production credentials.

From `mobile/`, export web, then run:

```text
node qa/parity-evidence/onboarding-test.mjs
node qa/parity-evidence/capture-native.mjs phase1-web
node qa/parity-evidence/capture-native.mjs phase2a-web
node qa/parity-evidence/capture-native.mjs provider-web
node qa/parity-evidence/capture-native.mjs provider2-web
node qa/parity-evidence/capture-native.mjs chat-web
```

From root:

```text
node mobile/qa/parity-evidence/capture-web.mjs
node mobile/qa/parity-evidence/compose.mjs
```

The committed comparisons are selected valid pairs. Intermediate blank/launch-overlay captures and generated exports are intentionally not committed.
