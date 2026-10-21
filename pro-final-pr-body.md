Fix the remaining provider audit issues: stable preview links during hydration, open-request-only rescheduling, action-dock clearance, earnings copy, and Arabic city display.

Scope: final provider audit follow-up to #145 and #164. Latest main (`829a647`, including #171) was merged into the feature branch without rebasing. No changes to customer/admin code, migrations, dependencies, booking transitions, pricing, commission policy, or earnings arithmetic. Locale additions are append-only. Preview routes were enabled only for local QA.

Implementation:
- Provider preview links use useSyncExternalStore with a false server snapshot; TeachingGroupsSummary, pending home and profile use the shared provider hook. Browser-dependent notification preferences mount after hydration.
- ProviderRescheduleSection hides absent/closed requests while retaining the existing actions for an open request. The dock reserves its height plus the bottom navigation height.
- Earnings shows the booking-value caption and summary commission note once; booking-specific notes remain on unsnapshotted rows. Profile reuses the existing Arabic governorate label.
- Regression tests cover hydration, reschedule visibility, earnings copy and Cairo localization.

Verification on the committed source:
- npx tsc --noEmit: exit 0.
- npx vitest run --maxWorkers=2: exit 0; 235 files passed, 7 skipped; 1,435 tests passed, 75 skipped. No worker timeout.
- npm run build: exit 0.
- node qa/check-ar-tashkeel.mjs: exit 0; 695 source files, no diacritics.
- git diff --check: exit 0.
- Local Chromium Arabic check, 390x844: exit 0; all six screens have zero hydration warnings, console errors and page errors.
- Prettier run on changed code/evidence, retaining scoped edits and append-only locales.

Screenshots: src/components/provider/__screenshots__/final-polish/README.md links before/after images for pending home, changes-requested home, profile, notification preferences, booking detail and earnings, plus expanded payment/support. The recorded support bottom (617px) and payment bottom (514px) are above the dock top (698px); the dock ends exactly at the navigation top (779px). Browser results and a replay script are included.

Diff: 35 files changed, 469 insertions(+), 33 deletions(-), including 13 screenshots.

Ready for Claude's independent review. Draft only; no merge or deployment performed.
