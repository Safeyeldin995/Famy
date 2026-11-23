# Mobile screen inventory (investor demo PR)

Legend: **Refreshed** = theme cards, radius, spacing, headers aligned with booking/wallet patterns in this PR. **Current** = already matched before this PR. **Legacy** = still on older patterns (out of scope or low traffic).

## Customer tabs

| Screen | Route | Status | Notes |
| --- | --- | --- | --- |
| Home | `(tabs)/home` | **Refreshed** | Tab padding helper, FeeDebtBanner margin, refresh/load fix |
| Bookings | `(tabs)/bookings` | **Current** | `Page tab` + `CustomerPageHeader` |
| Profile | `(tabs)/profile` | **Refreshed** | `ui.card` shadow/radius tokens |

## Customer stack (selected)

| Screen | Route | Status | Notes |
| --- | --- | --- | --- |
| Sign-in | `login` | **Current** | OAuth + theme buttons |
| Booking wizard | `book/[providerId]` | **Current** | Hero header, stepper, demo Apple Pay gate |
| Booking detail | `booking/[id]` | **Refreshed** | Uses `CustomerPageHeader`, `radius.xl` summary card |
| Search | `search` | **Current** | `CustomerSearchView` tokens |
| Messages | `messages` | **Current** | `ConversationList` + tab padding via `Page` |
| Addresses | `addresses` | **Current** | Card rows |
| Favorites | `favorites` | **Current** | `ProviderCard` refresh applies |
| Help / content | `help`, `content/[key]` | **Legacy** | Plain `Page`; low investor priority |
| Wallet (customer) | — | **N/A** | No customer wallet route; investor “wallet” = provider earnings |

## Provider tabs

| Screen | Route | Status | Notes |
| --- | --- | --- | --- |
| Dashboard | `(tabs)/dashboard` | **Current** | Theme spacing |
| Jobs | `(tabs)/jobs` | **Current** | `Page tab` |
| Earnings / wallet | `(tabs)/earnings` | **Current** | `ProviderWalletPanel` + cards |
| Pro profile | `(tabs)/pro-profile` | **Current** | Menu sections |

## Provider stack (selected)

| Screen | Route | Status | Notes |
| --- | --- | --- | --- |
| Pro booking detail | `pro-booking/[id]` | **Refreshed** | Removed hard-coded bottom pad; `Page` safe inset |
| Pending home | `pro-setup-home` | **Current** | `PendingHomeScreen` cards |
| Schedule | `schedule` | **Legacy** | Horizontal chip scroll; internal tool |

Bottom clearance: all `(tabs)/*` use `Page tab` or home `tabScrollContentPadding`; stack `Page` screens use `paddingBottom: space.xxxl + safeBottom` when not tabbed.