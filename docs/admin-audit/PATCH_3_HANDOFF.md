# Admin patch 3 — catalog and settings

## Outcome

Implemented on `codex/admin-patch-3`, based on main `f842023`. Draft only.
No database migrations, remote database access, customer/provider changes, main push, merge, or deployment.

**Not merge-ready: the focused browser gate still fails on the zones map SSR error described below.**

## Changes

- Services have separate Services / Subjects and curricula / Requirements views. Existing launch/outside-launch/test-data restrictions remain. Arabic service cards show price limits, duration and package hours. Editing uses a bottom sheet; updates and hides require explicit impact confirmation.
- Zones list precedes the retained map editor, with provider counts and service coverage. Provider linking supports name search. Zone status changes require confirmation.
- Promo cards show localized discounts, usage, expiry and activation controls. Optional audience/limits sections reduce the initial creation form.
- Payment methods and cancellation reasons use Arabic card labels and larger controls. Payment instructions have a plain-text customer preview, not HTML execution.
- Settings are collapsible explained sections, with confirmation before each existing mutation. Billing values are deliberately read-only: the existing billing mutation overwrites the complete billing JSON including commission, so using it for another value could inadvertently overwrite commission. No financial mutation is imported by this screen.
- Audit and monitoring show translated summaries and relative dates, with technical IDs/errors behind Details. Existing nested audit redaction remains.
- Admin preview data includes both launch services, taxonomy, promo usage, payment instructions, cancellation reasons and settings. Existing customer/provider seeds are unchanged.

## Verification

- `npm ci --no-audit --no-fund`: exit 0.
- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0, repeated after final presentation changes.
- `node qa/check-ar-tashkeel.mjs`: exit 0; 681 source files, no diacritics.
- Focused catalog/zone tests: 2 files, 10 tests passed, exit 0.
- Full `npx vitest run --maxWorkers=2`: **exit 0; 229 files passed / 7 skipped; 1406 tests passed / 75 skipped; 186.43s**. Initial run: 228 passed files, 7 skipped, 1 failed collection; 1402 tests passed / 75 skipped. The failed zone test mocked only useTranslation and omitted initReactI18next; corrected to preserve actual exports, without changing assertions. No worker-timeout exception was needed.
- `git diff --check`: exit 0.
- Browser: local synthetic preview routes, installed Microsoft Edge headless, Arabic, 390x844 and 1280x800. No live login, data changes or remote persistence proof.

## Open HIGH / blocked browser gate

The 390px focused browser command exits **1**, not pass. All eight screens had no document-level horizontal overflow and service edit/confirmation/cancel navigation succeeded with zero local API requests. A page error remains:

```text
Switched to client rendering because the server rendering errored:
window is not defined
```

A separate **diagnostic** 1280px capture identified `/preview/admin/zones` as the source; the other seven routes emitted no page errors. All eight had no document-level overflow. This diagnostic command also exits **1**.

The retained shared `ZonePolygonEditor` lazily imports `ZonePolygonMap`, which imports Leaflet. Suspense still renders the lazy map during SSR. The shared map files are unchanged. A likely bounded closure is a client-mount boundary in the admin route, followed by the unchanged browser validation. **Not implemented or silently allowlisted:** the new failure after the one drawer correction is parked under the repository anti-loop rule.

Earlier browser failure: the edit drawer's scrolling surface obscured Save. A separate inner scroll container fixed it; the final focused run reached all eight 390px routes. No forced clicks were used.

No live mutation test is claimed. Browser checks do not establish every control's clipping, validation or empty/error state. The scripts and screenshots are evidence, not independent review.

## Screenshots

These capture the actual guarded preview admin screens with synthetic data. The zones images show the client-recovered UI and do **not** close its SSR error.

| Screen               | 390px Arabic                                   | 1280px Arabic                                    |
| -------------------- | ---------------------------------------------- | ------------------------------------------------ |
| Services             | [Mobile](patch-3-services-390.png)             | [Desktop](patch-3-services-1280.png)             |
| Zones                | [Mobile](patch-3-zones-390.png)                | [Desktop](patch-3-zones-1280.png)                |
| Promo codes          | [Mobile](patch-3-promo-codes-390.png)          | [Desktop](patch-3-promo-codes-1280.png)          |
| Payment methods      | [Mobile](patch-3-payment-methods-390.png)      | [Desktop](patch-3-payment-methods-1280.png)      |
| Cancellation reasons | [Mobile](patch-3-cancellation-reasons-390.png) | [Desktop](patch-3-cancellation-reasons-1280.png) |
| Settings             | [Mobile](patch-3-settings-390.png)             | [Desktop](patch-3-settings-1280.png)             |
| Audit log            | [Mobile](patch-3-audit-log-390.png)            | [Desktop](patch-3-audit-log-1280.png)            |
| Monitoring           | [Mobile](patch-3-monitoring-390.png)           | [Desktop](patch-3-monitoring-1280.png)           |

## Next gate

Claude reviews this Draft and authorizes the bounded admin-map SSR closure. Do not merge until that browser gate is closed. No migration is needed.
