# Provider round 2 preview evidence

These screenshots record the original PR head `116082a`, before review corrections to actions, validation and earnings copy.

Captured locally on 2026-10-13 with Chromium, Arabic, Africa/Cairo, viewport 390 x 844. Full-page screenshots retain fixed navigation and action docks at the viewport position. All data is synthetic; preview mode was enabled only in the local server process. No production writes or migrations were performed.

The three application screens each measure 390 x 844. Long service lists can scroll within the screen while the action remains visible. The application walkthrough completed all three steps and found exactly one `طلبك كامل ✓` message. The request countdown rendered `رد خلال 12 ساعة`. The future confirmed booking's next-step button remained disabled. All captured screens were RTL, had no horizontal overflow, and displayed no raw `no_conversation` text.

Booking progression screenshots use seeded states, including the intermediate customer confirmations; they do not simulate a live customer approving arrival or completion. Existing server actions, confirmation dialogs, chat hooks and money calculations are unchanged.

## Remaining QA note

One existing preview-only hydration attribute warning remains in the shared `NotificationPreferencesPanel`: its fallback link renders `/pro/notifications` on the server and `/preview/pro/notifications` in the browser. The card renders correctly. The shared customer/provider file was left untouched under the parallel-work restriction; Claude should coordinate its fix with the customer owner. The final capture reported this one warning and no other browser errors. Earlier capture attempts were discarded after diagnosing stale Vite locale resources and Playwright's default caret-style injection racing hydration; final screenshots use the refreshed server and `caret: initial`.

## Screenshots

- [Application: name and areas](apply-1.png)
- [Application: services and prices](apply-2.png)
- [Application: identity and agreement](apply-3.png)
- [Application: missing-name guidance](apply-field-error.png)
- [Submission: one completion message](submitted.png)
- [Provider home and request card](home.png)
- [Bookings: pending request and countdown](requests.png)
- [Pending booking detail](pending.png)
- [Confirmed future booking: time-window lock](time-lock.png)
- [Accepted booking and chat](confirmed.png)
- [On the way](on_the_way.png)
- [Arrived, waiting for customer confirmation](arrived.png)
- [Arrival confirmed](arrival_confirmed.png)
- [Service started](in_progress.png)
- [Completion requested](completion_requested.png)
- [Completed booking](completed.png)
- [Paid and awaiting-payment totals](earnings.png)
- [Arabic notifications grouped by day](notifications.png)
- [Push unavailable: existing card, unchanged](push-fallback.png)
