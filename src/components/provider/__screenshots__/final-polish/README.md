# Provider final polish — Arabic browser evidence

Local Chromium, 390 × 844, Arabic language cookie and Africa/Cairo timezone. Synthetic preview data only; preview routes enabled only in the local server process.

Baseline screenshots were captured on 2026-10-14 from main `1fb91bf`. Final screenshots were refreshed on 2026-10-15 after merging main `829a647` and fixing provider preview hydration.

| Screen                   | Before                           | After                          |
| ------------------------ | -------------------------------- | ------------------------------ |
| Pending application      | [Before](before/pending.png)     | [After](after/pending.png)     |
| Changes requested        | [Before](before/changes.png)     | [After](after/changes.png)     |
| Profile                  | [Before](before/profile.png)     | [After](after/profile.png)     |
| Notification preferences | [Before](before/preferences.png) | [After](after/preferences.png) |
| Pending booking detail   | [Before](before/booking.png)     | [After](after/booking.png)     |
| Earnings                 | [Before](before/earnings.png)    | [After](after/earnings.png)    |

[Expanded payment details and support](after/booking-payment-support.png): payment bottom 514px; support bottom 617px; action dock top 698px; dock bottom and navigation top 779px. Both content items are fully visible above the dock.

## Results

Browser check: exit 0. All six screens have zero hydration warnings, console errors or page errors. No errors were filtered. The profile displays the existing Arabic label for Cairo. Earnings has exactly one page caption and one summary commission note; booking-specific wording stays on unsnapshotted rows. No empty reschedule block appears.

`browser-results.json` records baseline warnings and final clean results. `capture.cjs` reproduces the final check from the repository root while the local preview server runs on port 5187:

```sh
node src/components/provider/__screenshots__/final-polish/capture.cjs
```

Screenshots use `caret: "initial"` so Playwright does not inject input styles during hydration.

## Final local gates

- `npx tsc --noEmit`: exit 0.
- `npx vitest run --maxWorkers=2`: exit 0; 235 files passed, 7 skipped; 1,435 tests passed, 75 skipped. No worker timeout.
- `npm run build`: exit 0.
- `node qa/check-ar-tashkeel.mjs`: exit 0; 695 source files, no diacritics.
- `git diff --check`: exit 0.
- `node --check src/components/provider/__screenshots__/final-polish/capture.cjs`: exit 0.

The earlier Windows-sensitive admin assertion is resolved by merging main's PR #171; no admin source or test was edited in this patch.
