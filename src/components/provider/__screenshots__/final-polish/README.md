# Provider final polish — incomplete verification

Branch: `codex/pro-final-polish`, based on `1fb91bf31ed5723d0705f13a52ce9a00d43223d2`.
Screenshots are of the local uncommitted patch, captured 2026-10-14 using synthetic preview data, Arabic cookie, Africa/Cairo time, Chromium at 390 × 844. Preview was enabled only in the local server process.

| Screen | Before | After |
| --- | --- | --- |
| Pending application | before/pending.png | after/pending.png |
| Changes requested | before/changes.png | after/changes.png |
| Profile | before/profile.png | after/profile.png |
| Notification preferences | before/preferences.png | after/preferences.png |
| Pending booking detail | before/booking.png | after/booking.png |
| Earnings | before/earnings.png | after/earnings.png |

`after/booking-payment-support.png` shows expanded payment details and the support button after scrolling. Payment bottom: 514px; support bottom: 617px; dock top: 698px; dock bottom and nav top: 779px. Both items are fully visible above the dock.

Baseline hydration warnings: pending, changes, profile, preferences. Final browser check exits 1: profile still has a mismatched href in TeachingGroupsSummary (server /pro/setup/subjects, browser /preview/pro/setup/subjects). Other five screens have zero console/page errors. Full details are in browser-results.json. No errors were filtered.

Verification:
- npm ci: exit 0.
- npx tsc --noEmit: exit 0.
- Focused provider regression suite: 28 tests passed, exit 0.
- Corrected UTF-8 earnings/profile tests: 14 passed, exit 0.
- npx vitest run --maxWorkers=2: exit 1; 230 files passed, 1 failed, 7 skipped; 1,413 tests passed, 1 failed, 75 skipped. Untouched admin CatalogControls test at line 62 fails because its source-text regex captures a Windows carriage return.
- npm run build: not run after failed gate.
- node qa/check-ar-tashkeel.mjs: not run after failed gate.
- git diff --check: exit 0.

Stopped under AGENTS.md anti-loop policy. Changes are uncommitted and unpushed; no PR opened. Required follow-up: authorize one focused provider link fix and coordinate the unrelated Windows-sensitive admin assertion with its owner before final gates.
