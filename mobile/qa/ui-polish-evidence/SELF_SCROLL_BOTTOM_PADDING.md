# Self-managed scroll surfaces — bottom clearance

Screens that scroll outside the shared `Page` shell use `tabScrollContentPadding()` or explicit safe-area bottom inset.

| Screen | Route | Mechanism |
| --- | --- | --- |
| Customer home | `(customer)/(tabs)/home` | `tabScrollContentPadding(fontScale, insets.bottom)` on main `ScrollView` |
| Customer chat | `(customer)/chat/[id]` | `FlatList` `paddingBottom: space.xxxl + insets.bottom` |
| Provider chat | `(provider)/pro-chat/[id]` | Same as customer chat |
| Auth forms | `login`, `otp`, `forgot-password`, `set-password`, `oauth-setup` | `KeyboardFormScreen` — `SafeAreaView` edges + footer `paddingBottom: safeBottom` |
| Onboarding | `onboarding` | `SafeAreaView` + `paddingBottom` from `useSafeAreaInsets()` on slide chrome |
| Provider schedule chips | `(provider)/schedule` | Horizontal chip `ScrollView` inside `Page` (vertical scroll + bottom inset handled by `Page`) |

All `(tabs)/*` routes using `Page tab` inherit tab bar clearance via `Page`. Stack routes using `Page` without `tab` use `space.xxxl + safeBottom` in `Page` content padding.