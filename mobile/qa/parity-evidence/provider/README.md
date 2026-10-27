# Provider screen comparison (Arabic, 390×844)

Each linked PNG places the current web preview on the left and the provider route from the Expo web export on the right. These are local synthetic fixtures, not production accounts. The two fixture sets use different sample bookings, dates and balances, so compare layout and flow rather than the literal values. The Expo side is **not an Android emulator capture**; native-device visual parity still needs verification before this draft is considered complete.

| Screen | Web / app pair | Notes |
| --- | --- | --- |
| Dashboard | [dashboard](pairs/dashboard.png) | Work summary, requests, upcoming jobs |
| Jobs | [jobs](pairs/jobs.png) | Booking cards and status actions |
| Booking request | [booking](pairs/booking.png) | Accept and decline |
| Confirmed booking | [booking-confirmed](pairs/booking-confirmed.png) | Travel/start progression |
| Completed booking | [booking-completed](pairs/booking-completed.png) | Final status and back action |
| Schedule | [schedule](pairs/schedule.png) | Weekly hours, vacations, blocked dates |
| Earnings | [earnings](pairs/earnings.png) | Balance buckets and payouts |
| Messages | [messages](pairs/messages.png) | Conversation list |
| Chat | [chat](pairs/chat.png) | Thread and composer |
| Profile | [profile](pairs/profile.png) | Public details and service list |
| Profile edit | [profile-edit](pairs/profile-edit.png) | Web edits in profile; app uses a separate route |
| Documents | [documents](pairs/documents.png) | Identity and other document cards |
| Setup overview | [setup-home](pairs/setup-home.png) | Progress and outstanding sections |
| Setup: personal | [setup-personal](pairs/setup-personal.png) | Date and governorate selectors |
| Setup: about | [setup-about](pairs/setup-about.png) | Experience and bio |
| Setup: hours | [setup-hours](pairs/setup-hours.png) | Working hours editor |
| Setup: photo | [setup-photo](pairs/setup-photo.png) | Photo picker |
| Setup: babysitting | [setup-babysitting](pairs/setup-babysitting.png) | Children and ages |
| Setup: references | [setup-reference](pairs/setup-reference.png) | Reference fields |
| Setup: teaching subjects | [setup-subjects](pairs/setup-subjects.png) | Native grouped subject editor; save RPC exercised in fixture |
| Notifications | [notifications](pairs/notifications.png) | Day grouping and read state |
| Notification preferences | [notification-preferences](pairs/notification-preferences.png) | Native push switches differ from browser capability warning |

Additional app-only evidence: [decline](native/pro-booking-decline.png), [ready to start](native/pro-booking-ready-to-start.png), [in progress](native/pro-booking-in-progress.png), [vacation and blocked dates](native/pro-schedule-blocked.png), and [schedule saved](native/pro-schedule-save.png). The fixture verifies writes for accept, decline, start, completion request, schedule save, and teaching-group save; completed status itself is seeded because customer confirmation is a separate actor.

Recreate the pairs from the worktree root with the web preview fixtures enabled, then from `mobile/` run `npx expo export --platform web --output-dir dist-provider-parity`, `node qa/parity-evidence/provider/capture-native.mjs`, `node qa/parity-evidence/provider/capture-setup.mjs`, and `node qa/parity-evidence/provider/compose.mjs`. `capture-web.mjs` records the matching web-preview routes. All capture scripts intercept network traffic with local fixture data.

Remaining visual differences to resolve before claiming exact parity: profile editing uses a separate screen while web edits inline; fixture data and date differ; native notification preferences expose push controls while the web preview shows a browser-support warning. The app now has the same five provider tabs as web, with Messages reachable from profile and booking/chat links. The 390×844 Expo web rendering also cannot establish Android font metrics, safe-area spacing, or keyboard behavior.
