# Mobile/web parity — work in progress

**This branch does not complete screen-by-screen parity. Do not merge it as a completed parity release.**

Current continuation base: `ee2b120` (merged PR #241), branch `codex/mobile-web-parity-4`. Customer PR A2 is a partial draft; provider PR B has not started. Screens are captured at 390 × 844 in Arabic. Each comparison has web on the left and the actual Expo React Native Web export on the right. These are not recreated HTML mockups of native screens.

## PR #246 harness closure — 2026-10-27

Merged `origin/main` at `4907938` with merge commit `e12da14`, including the launch-overlay wait correction. The owner authorized editing `mobile/qa/*.cjs` for this closure. The failed browser gate recorded below is **historical and superseded by these runs**; exact visual parity is still incomplete.

All commands ran from `mobile/` against one fresh `dist-harness` web export, sequentially (never concurrent browser suites): `node qa/<name>.cjs dist-harness qa/parity-evidence/native/harness-final/<name>`.

| Harness               | Final result       | Evidence / limits                                                                                                                    |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `a11y-rtl.cjs`        | PASS, exit 0       | 71 touchables have role/label; RTL, contrast, font-scale and tab-height checks                                                       |
| `unit.cjs`            | PASS, exit 0       | Validation, matching, pricing/payload guards, idempotency, deep links, locale and OTP state checks                                   |
| `phase1-web.cjs`      | PASS, exit 0       | 22 Arabic captures; customer navigation and guarded mock writes, retry/empty states, DOB/consent validation                          |
| `phase2a-web.cjs`     | PASS, exit 0       | 23 captures; hourly/package/tutoring, 3 booking creates, cash/transfer/mock checkout, 2 receipt uploads, cancellation/review/address |
| `auth-signup-web.cjs` | PASS, exit 0       | Real exported login renders; local mock OTP send/context API smoke only. Not real SMS, Firebase or a complete sign-up flow           |
| `chat-web.cjs`        | PASS, exit 0       | 6 captures; list/thread, send, incoming message reload and error state                                                               |
| `provider-web.cjs`    | PASS, exit 0       | 13 captures and provider actions                                                                                                     |
| `provider2-web.cjs`   | PASS, exit 0       | 6 captures and provider application/profile/preferences/documents                                                                    |
| `waitLaunchGate.cjs`  | Module load exit 0 | Shared helper, not a standalone test; exercised by browser harnesses above                                                           |

### Causes and bounded corrections

- Added actual missing accessible labels using existing translated visible copy, and logical RTL style edges/corners. The splash artwork stays unchanged: the static RTL check verifies its explicit LTR coordinate canvas and only permits its two exact artwork coordinates, not arbitrary physical layout styles.
- The reported Home text failure did not reproduce after merging the launch wait. Both web and native still use `home.headline`; no Home assertion was removed. Phase 1's remaining stale address/promo copy and native-date locator now match the existing web-parity text and DOB sheets, keeping exact count, invalid-date/no-write and consent assertions.
- Booking dates/time buttons and promo disclosure locators match actual controls. The cancellation assertion targets `booking-status`, preserving the server-fixture cancellation assertion instead of matching the duplicate headline.
- Receipt reload was reproduced once with a Chromium crash listener. **No crash occurred**, and no `page.crash` event was emitted. The test reached later assertions and exposed the missing `booking_reschedule_requests` fixture. After adding the empty pending-request fixture, the complete suite passed. The original reload and PDF/persisted payment checks remain; no reload workaround or assertion removal was needed.
- Auth timeout was at launch wait after opening the HTTP-bundle export with `file://`. It now serves the actual export over local HTTP. Signed-out startup's exact OTP context request is fulfilled locally as missing intent, and unexpected external requests still fail. This replaced the ineffective `__MOCK_WEB_ORIGIN__` assumption without editing app auth. Reports contain booleans/status only, not intent tokens.
- Unit provider fixtures now include `services: []`, matching the current `Provider` data contract. Shared-query/data guards were not weakened.

Root `npm run test:unit -- --maxWorkers=2`: **exit 0; 261 files passed / 4 skipped; 1,540 tests passed / 64 skipped**, duration 226.21s. Mobile `npx tsc --noEmit`: **exit 0**. Changed-file ESLint (one existing Fast Refresh warning in Primitives), Prettier, CJS syntax checks, Arabic guard and diff check passed. No live data, credentials, production actions or provider parity implementation occurred. Existing screenshots below remain visual-gap evidence, not a claim that all screens now match.

## Customer PR A2 — 2026-10-27 (historical, before harness closure)

The owner authorized one focused harness correction and one sequential rerun, then instructed us to stop and push a draft if it failed. The stale exact-area locator was corrected to assert the complete address text. The customer suite passed; the booking suite crashed on reload. **No further browser rerun was attempted. This is not a completed parity release.** Older sections below describe historical runs, not this head.

### Changes and remaining acceptance gaps

| Screen                   | Implemented / differences still open                                                                                                                                                                                    | Fixed (yes/no) | Current web / app comparison                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| Profile                  | Camera action using existing owner avatar upload; name/address edit link and route; notification preferences link. Exact spacing, shadows and language button still differ.                                             | No             | [Profile](comparisons/profile.png)                                    |
| Bookings                 | Brand-pink selected pill; confirmed grey status pill; round initial avatar. Exact card spacing, price typography and all segment states remain.                                                                         | No             | [Bookings](comparisons/bookings.png)                                  |
| Booking steps            | Service cards, 14-day strip/time slots, recipient chips, editable summary and promo disclosure. Inline address/member sheets, duration placement, teaching selection, review ordering and complete state parity remain. | No             | [Step 1](comparisons/booking-step-1.png)                              |
| Chat thread              | Customer header, avatar, mint notice, chronological messages, composer; blocked draft retained. Populated conversation, media and device behavior remain unverified.                                                    | No             | [Chat](comparisons/chat.png)                                          |
| Addresses list/new/edit  | Compact cards, edit route, reuse create form, owner-scoped update. Web map picker and exact sheet/field layout remain. New/edit save is not exercised by the browser suite.                                             | No             | [List](comparisons/addresses.png), [New](comparisons/address-new.png) |
| Name/address setup       | Name hydration and existing default address, owner-scoped name/address save. Web map/contact-phone flow and exact layout remain. Two saves are sequential, not atomic.                                                  | No             | [Setup](comparisons/setup.png)                                        |
| Notification preferences | Existing account preference hooks and category toggles; device settings action. Web device registration/revocation list is not ported.                                                                                  | No             | [Preferences](comparisons/notification-preferences.png)               |
| Delete account           | Header, guard messaging, confirmation/cancel layout. No deletion executed; all guard/error states are not compared.                                                                                                     | No             | [Delete account](comparisons/delete-account.png)                      |
| Other customer screens   | Inherit PR #241 improvements; outstanding differences in its table below remain. No blanket parity claim.                                                                                                               | No             | Earlier comparison links below                                        |
| Provider screens         | Deferred until A2 is merged, per owner instruction.                                                                                                                                                                     | No             | No new provider evidence                                              |

### Exact check results

- Root `npm run test:unit -- --maxWorkers=2`: **exit 0; 261 files passed / 4 skipped; 1,540 tests passed / 64 skipped**.
- Mobile `npx tsc --noEmit`: **exit 0**.
- Mobile `npx expo export --platform android`: **exit 0**. Not an APK/device test.
- Mobile web export: **exit 0**.
- Changed TS/TSX ESLint and Prettier: **exit 0**.
- `node qa/check-ar-tashkeel.mjs`: **exit 0; 758 source files**. `git diff --check`: **exit 0**.
- Final sequential browser command: **exit 1**. `customer-v2-test.mjs` completed successfully with **30 Arabic captures**, existing guarded mock interactions, profile edit navigation/hydration, address screens, notification preferences, delete guard, chat contact-blocked draft retention, and reschedule actions. All remote requests intercepted; no live data.
- `booking-v4-test.mjs`: **failed**, `page.reload: Page crashed` in the package transfer-receipt scenario after uploading/viewing the mocked receipt and clearing its mocked `proof_path`, before PDF upload checks. Stack identifies protected fixture line 663 after adapter expansion (original reload around line 660). Hourly steps and package steps reached screenshots, but the suite as a whole did not pass; later PDF/tutoring assertions were not reached.
- A failure screenshot could not be taken because Chromium had crashed. [Last successful frame immediately before reload](failures/a2-before-reload-crash.png) is preserved; **it is not a screenshot of the crash**. [Failure record](failures/a2-booking-reload.md).

Nine comparisons above were assembled from actual captured images, not an application rerun. Web preview and native fixtures differ in names, prices, dates and counts: these are visual evidence, not pixel-equality assertions. Web profile/bookings/addresses/chat/setup/address-new/preferences/delete/step-1 captures were refreshed in this continuation; other comparisons are inherited. Native new/edit account saves, camera upload, native device behavior and full loading/error permutations remain unverified. Protected auth/session/LaunchGate/app.json and `mobile/qa/*.cjs` are unchanged. No remote database or production mutation occurred.

## Customer PR A continuation — 2026-10-27

This is a partial implementation checkpoint, **not completion of the requested two-PR program**. No protected auth/session/LaunchGate/app.json or `mobile/qa/*.cjs` file was edited. No production or credentialed QA operation occurred. The Supabase skill was used only to keep local previews isolated: dummy localhost configuration and intercepted browser requests, not live credentials.

Implemented: compact search/category filters, merged dual-service results, provider-profile section hierarchy and grouped teaching ranges, three booking-history tabs and rebook actions, grouped profile menu, customer message rows, Cairo-day notification groups, family list/footer and year/month/day selectors, promo sections/copy feedback, help contact tiles/accordion, legal-content header/card. Existing mutations and server guards remain; no auth or pricing policy changes.

### Current acceptance table

All entries remain **No** until fixture-normalized full-screen/state comparisons and interaction coverage are complete. A ported section is not a claim of exact parity.

| Screen                                | Differences fixed in this continuation / still remaining                                                                                                                           | Fixed (yes/no) | Current comparison                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Search                                | Compact search/chips/pickers and one row per provider with merged services; card typography/price formatting and exact fixture equivalence remain                                  | No             | [Pair](comparisons/search.png)                                                                     |
| Categories: babysitting/tutoring      | Web result summary, service/student sheets and sort chips; subtitle/matching badge and exact fixture data remain                                                                   | No             | [Babysitting](comparisons/category-babysitting.png), [Tutoring](comparisons/category-tutoring.png) |
| Public provider                       | Web section order, toolbar/share/favorite, service rows, grouped tutoring levels, hours and sticky booking CTA; review author avatar/name and complete states remain               | No             | [Pair](comparisons/provider.png)                                                                   |
| Booking flow, every step              | Not changed in this continuation; web/native step layout remains unmatched                                                                                                         | No             | Prior evidence only                                                                                |
| Bookings list                         | Three tabs, compact avatar/status/date/price cards and rebooking; exact status tones/data and all tab states remain                                                                | No             | [Pair](comparisons/bookings.png)                                                                   |
| Messages / chat                       | Customer list header and round-avatar rows ported; populated list capture and chat body/read-only status remain                                                                    | No             | Prior paired evidence only                                                                         |
| Profile                               | Web grouped menu structure; photo/edit route, notification preferences destination and exact spacing remain                                                                        | No             | [Pair](comparisons/profile.png)                                                                    |
| Addresses list/new/edit               | Not changed in this continuation; edit screen still absent                                                                                                                         | No             | Prior evidence only                                                                                |
| Family list/new/edit                  | Compact cards, bottom add action, controlled DOB sheets, relationship grid and grouped education/emergency fields; exact text sizes, field labels, validation and edit pair remain | No             | [List](comparisons/family-members.png), [New](comparisons/family-member-new.png)                   |
| Favorites                             | Benefits from compact provider row; full populated/empty parity still open                                                                                                         | No             | Prior evidence only                                                                                |
| Promos                                | Available/history sections, dark available card/copy control, date/used row; exact redemption description and all states remain                                                    | No             | [Pair](comparisons/promo-codes.png)                                                                |
| Notifications                         | Cairo calendar grouping, time labels, read/unread card/icons; full routing/state parity remains                                                                                    | No             | [Pair](comparisons/notifications.png)                                                              |
| Help                                  | Contact tiles and accordion, floating panel; native-device clipping/interaction verification remains                                                                               | No             | [Pair](comparisons/help.png)                                                                       |
| Terms / privacy                       | Customer header/content card ported; no current paired web preview evidence                                                                                                        | No             | Native captures only                                                                               |
| Delete account                        | Not changed or exercised in this continuation                                                                                                                                      | No             | Prior web evidence only                                                                            |
| All provider workspace screens (PR B) | Not started on this branch; keep in a separate PR                                                                                                                                  | No             | Prior baseline only                                                                                |

### Verification and evidence limits

- Root `npm run test:unit` initially exited 1: **1,536 passed, 64 skipped, 3 timeout failures**, in unchanged QA stability/production-reset tests. The two underlying timed-out files subsequently passed **78/78** in isolation with two workers. No assertions/timeouts were weakened. Final root `npm run test:unit -- --maxWorkers=2`: **exit 0, 1,539 passed / 64 skipped; 261 files passed / 4 skipped**.
- Mobile TypeScript passed. Android/Hermes and web exports passed. Changed-file ESLint passed with two Fast Refresh export warnings (Page/Primitives), not errors.
- The isolated customer runner passed **24 Arabic captures** and existing customer interactions, including the new DOB sheets, future-year exclusion, incomplete-date rejection, explicit health consent, family create/soft removal, promo clipboard, booking chat navigation and reschedule guards. This is mock/export evidence, not a live/device test.
- Added four unit regressions: dual-service aggregation without input mutation; Cairo midnight grouping; DST calendar subtraction; Latin-digit Arabic times.
- Eleven current side-by-side pairs are linked above. Native fixture data and web preview fixture data differ (names, services, amounts, counts); these are diagnostic comparisons, not pixel-equality proof. Other pairs below are historical evidence and must not be presented as current verification.
- Initial browser spawn was blocked by the sandbox; approved local child-process execution resolved it. Web preview required dummy local configuration; error-page captures were rejected. The old promo locator was corrected once to the web accessibility label; no protected runner was modified. DOB fixture assertions were intentionally ported to the actual new selectors, retaining negative no-write checks.

## Historical PR #237 / #238 notes (not current completion evidence)

## Current customer/launch group

### PR #238 follow-up (2026-10-27)

- Splash asset hashes resolve from `import.meta.url`, not the process working directory. The asset assertion now passes in the root unit suite as well as the mobile configuration.
- The provider-row `مراسلة` action is always visible, with web-sized spacing. On tap it refetches only this booking's authorized conversation and opens `/chat/<conversation-id>`. Missing/status-unavailable chats show the translated explanation; query failures show the translated error. No conversation is created and no server access rule changes.
- Requested root `npm run test:unit`: **exit 1 — 1533 passed, 64 skipped, 2 failed**. Both failures are in unchanged `fixed-price-packages.test.ts` (lines 127 and 142). Its `now() + 2 days` fixture currently falls on Cairo's 2026-10-29 DST transition: 18:00 plus six elapsed hours is 23:00, and plus seven is midnight. This contradicts those two ordinary-night assertions. The mobile splash assertion no longer fails; the root suite is not claimed green. No pricing/test-calendar fix was made in this mobile scope.
- Mobile TypeScript and changed-file ESLint: exit 0. Remaining screens wait for the owner's merge of #238 before a fresh branch from main.
- Mobile unit configuration: 22/22 passed. Web export: exit 0. Isolated customer browser: exit 0, 24 captures; asserts the visible message action, missing-conversation explanation, then navigation to the exact booking conversation and a loaded composer. Updated booking-detail pair below. No live backend interaction. The runner's initial pre-launch syntax failure was fixed by using a function replacement so embedded regex dollar signs remain literal.

- LaunchGate uses the web's actual shared splash state function, 4.2-second timeline, blink/motion/reveal and byte-identical PNG layers. The current web source has **no tagline**; none was invented. The native process plays once; the web export uses the same session-storage marker. Reduced motion skips animation. The existing readiness guards, `launch-overlay` test ID and independent fail-safe remain.
- Onboarding dots explicitly run right-to-left in Arabic and left-to-right in English. All three active positions are asserted in both languages.
- Home uses the requested service titles, all returned active promotions in a horizontal snap carousel, the floating four-tab navigation and nearby-provider heading/see-all/cards. Provider cards use the web's compact round-avatar layout. Rebook/trust sections and exact shadow/spacing reconciliation remain unfinished.
- Booking detail now has the header/support action, status card, provider/message row, icon-led visit summary and total, receipt/calendar/support tiles, reschedule requests/history, price breakdown and existing payment/actions. Receipt/calendar file contents mirror web. Native sharing uses `expo-sharing`; it requires a new native binary. No auth, payment policy or booking guard was changed.
- Reschedule writes call the existing guarded RPCs only. Request/withdraw and payloads were exercised through isolated mocks; live scheduling and native sharing were not tested. Support still opens the existing Help route, rather than web's booking-specific support sheet. Chat is shown only when an existing authorized conversation is returned. Tracking/support dialogs and all status-specific web detail variants remain unmatched.
- Protected auth/session/config and `mobile/qa/*.cjs` files are unchanged. LaunchGate is the explicit permitted exception. The new nested `.mjs` runner extends synthetic fixtures in memory and never edits protected runners.

### Current checks

- Mobile `npx tsc --noEmit`: exit 0.
- Mobile `npx vitest run --config vitest.config.ts`: 22/22 tests across 5 files, exit 0; focused parity/timer subset 9/9.
- Android export and web export: exit 0. An export is **not** an APK/device test.
- `onboarding-test.mjs`: exit 0; normal splash, play-once, reduced motion, stalled-animation fail-safe, Arabic/English dots, persistence, Skip and failed-storage fallback.
- `customer-v2-test.mjs`: isolated existing customer scenarios plus multi-promo Home, tab direction/navigation, receipt/calendar downloads, reschedule request payload and confirmed withdrawal; 23 captures, exit 0.
- Changed TS/TSX ESLint: exit 0, one non-component-export warning in LaunchGate. Arabic guard: exit 0 (757 source files).
- Initial fixture failure was an unmocked `booking_reschedule_requests` read, not a product assertion; the new wrapper now supplies the matching synthetic table/RPC contracts and the final run passes. External requests remain blocked.
- Installing SDK-compatible `expo-sharing` succeeded, but Expo's automatic config edit exited 1 because this app uses dynamic config. Inspection established that its plugin is for **incoming** share extensions; outgoing `shareAsync` uses native autolinking and needs no app-config edit. Protected config was not changed. The install reported 12 high dependency advisories; no broad audit fix was attempted.
- No real device, SMS, live customer/provider session, database operation or production action was used. Independent review and CI are still separate gates.

### Evidence freshness

Current native captures: onboarding, Home, search, babysitting category, public provider, bookings/detail, profile and the customer account screens produced by `customer-v2-test.mjs`. Current web captures were refreshed from `b5d1b4b`. Other native panels (provider screens, chat, tutoring category, booking-step fixtures) are inherited PR #237 baseline evidence, **not rerun proof**. Their unchanged screenshots expose remaining work only.

## Implemented

- Native onboarding: the three original PNGs (byte-identical), shared web translations, wordmark, language toggle, Skip, dots, page counter, Next/Start, and safe-area spacing.
- First signed-out entry reads AsyncStorage `onboarded`; Skip/Start persists completion and opens login. Signed-in workspace routing is preserved. Storage failure does not trap the user.
- Home: web-style horizontal promo strip with copy feedback; 160px service tiles; customer floating RTL navigation bar and selected-icon pill.
- Addresses, family, notifications: ported web page headers. Favorites, help, promos: ported web hero headers. Favorites has the web empty-state text/icon/browse action.
- Main's protected auth/session/app.json and QA cjs changes are preserved exactly. LaunchGate is changed only under the new explicit authorization above.
- Schedule weekly hours now use the web's shared time choices and Arabic labels in searchable bottom-sheet selectors, a visible same-hours checkbox and selected-day checks. Shared/individual editing retains the existing atomic availability RPC. Loading/error states cannot save an empty draft; an empty successful response clears stale rows.

## Evidence limits

- Web runs through `npm run dev` and existing `/preview` routes. Native runs the exported application using existing synthetic fixtures. All external browser requests are intercepted/blocked. Google Fonts CSS is fulfilled locally using the installed copies of Almarai/Manrope.
- Preview-only web hub links/banner are removed from screenshots; application elements are not removed. Captures wait for hydration and the native launch overlay.
- Fixture records differ between platforms (names, prices, counts, services). These images expose layout differences; they are **not** a pixel equality test or proof of equal backend behavior.
- No real login, SMS, customer/provider data, migration, payment, or production write occurred. Android export is not Android-device interaction evidence.
- Missing comparisons below are explicitly unverified, not passed. Provider ports and remaining screen bodies are unfinished implementation, not blocked by permissions.

## Screen matrix

“Yes” means the requested onboarding port/flow was implemented and exercised. “No” includes partially changed screens whose complete parity is still open.

| Screen                                                                   | Differences found / remaining work                                                                                                                             | Fixed (yes/no)             | Evidence                                                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Splash                                                                   | Shared web state, assets, timeline and play-once/reduced-motion rules ported; fail-safe tested; native-device rendering unverified                             | Yes (export/mock evidence) | [Pair](comparisons/splash.png)                                                                        |
| Onboarding, three slides                                                 | Same images/copy/controls; active-dot direction and positions now asserted in AR/EN; persistence/Skip/return visit tested                                      | Yes                        | [1](comparisons/onboarding.png), [2](comparisons/onboarding-2.png), [3](comparisons/onboarding-3.png) |
| Customer home                                                            | Requested strings, carousel, nearby heading/cards and floating nav ported; rebook/trust, exact shadows/spacing and fixture normalization still differ          | No                         | [Pair](comparisons/home.png)                                                                          |
| Search                                                                   | Filter controls, spacing and provider result rows need port                                                                                                    | No                         | [Pair](comparisons/search.png)                                                                        |
| Babysitting category                                                     | Header, filters, provider rows differ                                                                                                                          | No                         | [Pair](comparisons/category-babysitting.png)                                                          |
| Tutoring category                                                        | Header, filters, provider rows differ                                                                                                                          | No                         | [Pair](comparisons/category-tutoring.png)                                                             |
| Provider public profile                                                  | Native hero/card, service rows, stats, teaching information and sticky booking action differ                                                                   | No                         | [Pair](comparisons/provider.png)                                                                      |
| Booking step 1                                                           | Native progress strip and separate duration box differ from web provider summary/service cards                                                                 | No                         | [Pair](comparisons/booking-step-1.png)                                                                |
| Booking step 2                                                           | Native captured; interactive web date/slot state not captured for same fixture                                                                                 | No                         | Native fixture capture only                                                                           |
| Booking step 3                                                           | Native captured; matching web address/recipient state not captured                                                                                             | No                         | Native fixture capture only                                                                           |
| Booking step 4                                                           | Native captured; matching web review/payment state not captured                                                                                                | No                         | Native fixture capture only                                                                           |
| Package/tutoring booking variants                                        | Existing isolated native scenarios pass; cross-platform layout comparison incomplete                                                                           | No                         | Native fixture capture only                                                                           |
| Customer bookings                                                        | Navigation improved; status tabs/list cards remain different                                                                                                   | No                         | [Pair](comparisons/bookings.png)                                                                      |
| Customer booking detail                                                  | Overview hierarchy, file actions and guarded reschedule flow ported; support-sheet/tracking/status variants and native share intent still unverified/unmatched | No                         | [Pair](comparisons/booking-detail.png)                                                                |
| Customer messages                                                        | List/row/header presentation remains different                                                                                                                 | No                         | [Pair](comparisons/messages.png)                                                                      |
| Customer chat                                                            | Composer/bubble/header layout requires reconciliation                                                                                                          | No                         | [Pair](comparisons/chat.png)                                                                          |
| Customer notifications                                                   | Header/mark-all placement ported; grouping, date labels and row styling remain                                                                                 | No                         | [Pair](comparisons/notifications.png)                                                                 |
| Customer profile                                                         | Navigation improved; account hero/menu structure still differs                                                                                                 | No                         | [Pair](comparisons/profile.png)                                                                       |
| Addresses                                                                | Header ported; card actions/add placement remain different                                                                                                     | No                         | [Pair](comparisons/addresses.png)                                                                     |
| Address creation                                                         | Native captured; matching web form state not captured                                                                                                          | No                         | Native fixture capture only                                                                           |
| Family members                                                           | Header/privacy copy ported; row avatar/actions/add placement still differ                                                                                      | No                         | [Pair](comparisons/family-members.png)                                                                |
| Family member creation                                                   | Form control layout/date input remains different                                                                                                               | No                         | [Pair](comparisons/family-member-new.png)                                                             |
| Family member edit                                                       | Native captured; paired edit state not captured                                                                                                                | No                         | Native fixture capture only                                                                           |
| Favorites                                                                | Hero and empty state ported; populated row needs web ProviderListRow port                                                                                      | No                         | [Pair](comparisons/favorites.png)                                                                     |
| Promo codes                                                              | Hero ported; available and redeemed promo card bodies remain different                                                                                         | No                         | [Pair](comparisons/promo-codes.png)                                                                   |
| Help                                                                     | Hero ported; contact/FAQ presentation still differs                                                                                                            | No                         | [Pair](comparisons/help.png)                                                                          |
| Terms/privacy                                                            | Native fixture captures exist; web has no corresponding preview route captured here                                                                            | No                         | No valid pair                                                                                         |
| Delete account                                                           | Web preview captured; native destructive flow not exercised by existing fixture suite                                                                          | No                         | No valid pair                                                                                         |
| Provider dashboard                                                       | Header, metrics label, booking cards, upcoming row and navigation differ                                                                                       | No                         | [Pair](comparisons/dashboard.png)                                                                     |
| Provider jobs                                                            | Header, filters, request cards and navigation differ                                                                                                           | No                         | [Pair](comparisons/jobs.png)                                                                          |
| Provider schedule                                                        | Time selectors and same-hours/day controls ported; page header, vacation lists, blocked dates, advanced rules and navigation still differ                      | No                         | [Pair](comparisons/schedule.png)                                                                      |
| Provider earnings                                                        | Metrics/labels/sections/date presentation differ                                                                                                               | No                         | [Pair](comparisons/earnings.png)                                                                      |
| Provider messages/chat                                                   | Native fixtures captured; matching provider web preview route not available in the registry used here                                                          | No                         | No valid pair                                                                                         |
| Provider profile                                                         | Status/menu/service readiness layout differs                                                                                                                   | No                         | [Pair](comparisons/pro-profile.png)                                                                   |
| Provider profile edit                                                    | Native captured; corresponding editable web state not captured                                                                                                 | No                         | No valid pair                                                                                         |
| Provider documents                                                       | Native upload/list layout differs from web review statuses                                                                                                     | No                         | [Pair](comparisons/pro-documents.png)                                                                 |
| Provider application (3 native steps)                                    | Native fixtures captured; web setup structure differs                                                                                                          | No                         | No valid pair                                                                                         |
| Provider setup home                                                      | Web pending preview captured; matching native setup-home fixture not captured                                                                                  | No                         | No valid pair                                                                                         |
| Provider setup photo/about/babysitting/subjects/reference/personal/hours | Web preview captured per section; native paired fixtures/ports still needed                                                                                    | No                         | No valid pairs                                                                                        |
| Provider notifications                                                   | Grouped web list vs native cards/date labels                                                                                                                   | No                         | [Pair](comparisons/pro-notifications.png)                                                             |

## Historical PR #237 checks (not current-run claims)

Latest merge/schedule continuation (earlier broad-suite results below are not claimed as rerun):

- Mobile TypeScript and both Android/web exports: exit 0.
- `schedule-test.mjs`: passed the unchanged provider fixture's assertions and 13 captures, plus searchable Arabic time selection, shared/individual editing, unchanged `HH:MM` RPC payloads, midnight, dismiss and 390px width checks. It uses five fixture working days; an initial assertion incorrectly expected two and was corrected to the fixture length.
- Changed TS/TSX ESLint: exit 0, one existing non-component-export warning in `WeeklyHoursEditor`.
- Arabic guard: exit 0, 757 source files.
- Initial Chromium/Hermes launches were sandbox-denied (`EPERM`); approved local process launches passed. No remote backend traffic or real device verification.

Earlier implementation checks:

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
node qa/parity-evidence/customer-v2-test.mjs
node qa/parity-evidence/capture-native.mjs phase1-web
node qa/parity-evidence/capture-native.mjs phase2a-web
node qa/parity-evidence/capture-native.mjs provider-web
node qa/parity-evidence/schedule-test.mjs
node qa/parity-evidence/capture-native.mjs provider2-web
node qa/parity-evidence/capture-native.mjs chat-web
```

From root:

```text
node mobile/qa/parity-evidence/capture-web.mjs
node mobile/qa/parity-evidence/compose.mjs
```

The committed comparisons are selected valid pairs. Intermediate blank/launch-overlay captures and generated exports are intentionally not committed.
