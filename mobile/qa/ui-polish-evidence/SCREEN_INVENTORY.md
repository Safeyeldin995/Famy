# Mobile route inventory (`mobile/src/app`)

Legend: **Refreshed** = updated in investor-demo / Codex follow-up PR. **Current** = already matched design system before this pass. **Legacy** = unchanged low-traffic or internal; acceptable for demo.

## Root / auth / guest

| File | Route | Audience | Status |
| --- | --- | --- | --- |
| `index.tsx` | `/` | both | **Current** | Redirect/bootstrap |
| `_layout.tsx` | — | both | **Current** | Shell |
| `login.tsx` | `/login` | auth | **Current** | OAuth + `KeyboardFormScreen` |
| `otp.tsx` | `/otp` | auth | **Current** | |
| `forgot-password.tsx` | `/forgot-password` | auth | **Current** | |
| `set-password.tsx` | `/set-password` | auth | **Current** | |
| `oauth-setup.tsx` | `/oauth-setup` | auth | **Current** | |
| `onboarding.tsx` | `/onboarding` | auth | **Current** | Safe-area padding |
| `workspace-on-web.tsx` | `/workspace-on-web` | both | **Current** | |
| `guest/_layout.tsx` | `/guest` | guest | **Current** | |
| `guest/index.tsx` | `/guest` | guest | **Current** | |
| `guest/provider/[id].tsx` | `/guest/provider/:id` | guest | **Current** | |

## Customer — tabs

| File | Route | Status |
| --- | --- | --- |
| `(customer)/(tabs)/home.tsx` | `/home` | **Refreshed** | Freeze/refresh fixes, tab padding |
| `(customer)/(tabs)/bookings.tsx` | `/bookings` | **Current** | `Page tab` |
| `(customer)/(tabs)/profile.tsx` | `/profile` | **Refreshed** | Card tokens |
| `(customer)/(tabs)/_layout.tsx` | — | **Current** | |

## Customer — stack

| File | Route | Status |
| --- | --- | --- |
| `(customer)/search.tsx` | `/search` | **Current** | |
| `(customer)/category/[id].tsx` | `/category/:id` | **Current** | |
| `(customer)/provider/[id].tsx` | `/provider/:id` | **Current** | |
| `(customer)/book/[providerId].tsx` | `/book/:id` | **Current** | Demo Apple Pay row |
| `(customer)/booking/[id].tsx` | `/booking/:id` | **Refreshed** | Header + summary card |
| `(customer)/booking-coming-soon.tsx` | `/booking-coming-soon` | **Current** | |
| `(customer)/messages.tsx` | `/messages` | **Current** | |
| `(customer)/chat/[id].tsx` | `/chat/:id` | **Refreshed** | Thread bottom inset |
| `(customer)/notifications.tsx` | `/notifications` | **Current** | |
| `(customer)/notification-preferences.tsx` | `/notification-preferences` | **Current** | |
| `(customer)/addresses.tsx` | `/addresses` | **Current** | |
| `(customer)/addresses/new.tsx` | `/addresses/new` | **Current** | |
| `(customer)/addresses/[id].tsx` | `/addresses/:id` | **Current** | |
| `(customer)/family-members/index.tsx` | `/family-members` | **Current** | |
| `(customer)/family-members/new.tsx` | `/family-members/new` | **Current** | |
| `(customer)/family-members/[id].tsx` | `/family-members/:id` | **Current** | |
| `(customer)/favorites.tsx` | `/favorites` | **Current** | |
| `(customer)/promo-codes.tsx` | `/promo-codes` | **Current** | |
| `(customer)/help.tsx` | `/help` | **Refreshed** | Radius/shadow/spacing |
| `(customer)/content/[key].tsx` | `/content/:key` | **Refreshed** | Card shadow + radius |
| `(customer)/setup.tsx` | `/setup` | **Current** | |
| `(customer)/delete-account.tsx` | `/delete-account` | **Current** | |
| `(customer)/_layout.tsx` | — | **Current** | |

## Provider — tabs

| File | Route | Status |
| --- | --- | --- |
| `(provider)/(tabs)/dashboard.tsx` | `/pro-dashboard` | **Current** | |
| `(provider)/(tabs)/jobs.tsx` | `/pro-jobs` | **Current** | |
| `(provider)/(tabs)/earnings.tsx` | `/pro-earnings` | **Current** | Wallet / earnings panel |
| `(provider)/(tabs)/pro-profile.tsx` | `/pro-profile` | **Current** | |
| `(provider)/(tabs)/_layout.tsx` | — | **Current** | |

## Provider — stack

| File | Route | Status |
| --- | --- | --- |
| `(provider)/pro-booking/[id].tsx` | `/pro-booking/:id` | **Refreshed** | `Page` safe inset |
| `(provider)/pro-messages.tsx` | `/pro-messages` | **Current** | |
| `(provider)/pro-chat/[id].tsx` | `/pro-chat/:id` | **Refreshed** | Thread bottom inset |
| `(provider)/pro-notifications.tsx` | `/pro-notifications` | **Current** | |
| `(provider)/pro-notification-preferences.tsx` | `/pro-notification-preferences` | **Current** | |
| `(provider)/schedule.tsx` | `/pro-schedule` | **Refreshed** | Chip tokens |
| `(provider)/pro-onboarding.tsx` | `/pro-onboarding` | **Current** | |
| `(provider)/pro-setup-home.tsx` | `/pro-setup-home` | **Current** | |
| `(provider)/pro-setup/[item].tsx` | `/pro-setup/:item` | **Current** | |
| `(provider)/pro-profile-edit.tsx` | `/pro-profile-edit` | **Current** | |
| `(provider)/pro-apply.tsx` | `/pro-apply` | **Current** | |
| `(provider)/pro-request-service.tsx` | `/pro-request-service` | **Current** | |
| `(provider)/pro-documents.tsx` | `/pro-documents` | **Current** | |
| `(provider)/pro-delete-account.tsx` | `/pro-delete-account` | **Current** | |
| `(provider)/_layout.tsx` | — | **Current** | |

Bottom clearance details: [SELF_SCROLL_BOTTOM_PADDING.md](./SELF_SCROLL_BOTTOM_PADDING.md).