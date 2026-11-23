# Customer home “stopping” — evidence

## Investigated (and rejected): unstable `bookings.refetch` in `useFocusEffect`

TanStack Query v5 exposes `refetch` from `useQuery` with a **stable** function identity across renders when the observer is unchanged ([`useBaseQuery`](https://github.com/TanStack/query/blob/main/packages/react-query/src/useBaseQuery.ts)). Unit guard: `mobile/src/ui/__tests__/homeFocusEvidence.test.ts`.

Adding `bookings.refetch` to `useFocusEffect` deps therefore does **not** explain a refetch storm on every render while Home is focused.

## Dev-only counters (web export, 390×844)

Harness: `node qa/home-freeze-diag.cjs dist-freeze-diag [0|1]`  
Scenario: open `/home`, wait **30s** on home, switch tabs **bookings → profile → home** twice (tab bar clicks, not full reloads).  
Counters: `focusEffectRuns`, per-query fetch **start** edges (`isFetching` false→true), plus `bookingsFocusRefetch` (legacy) vs `bookingsFocusInvalidate` (current).

Committed outputs: `mobile/qa/home-freeze-diag-current.json`, `mobile/qa/home-freeze-diag-legacy.json` (2026-11-23).

| Metric | Current (fix) | Legacy (`famy.homeFreezeLegacy=1`) |
| --- | --- | --- |
| `focusEffectRuns` after 30s on home | 1 | 1 |
| `focusEffectRuns` after 2 tab cycles | 3 | 3 |
| `bookings` fetch starts (after cycles) | 4 | 4 |
| `bookingsFocusInvalidate` (after cycles) | 3 | — |
| `bookingsFocusRefetch` (after cycles) | — | 3 |

**Plain result:** the **refetch-dependency theory is ruled out** by these counters — tab-return focus effect count and booking fetch-start edges are the same for current vs legacy; legacy only adds explicit `bookings.refetch()` on focus (3×) vs invalidation markers.

This harness does **not** pull-to-refresh, does not measure frame jank, and is **web-only** (no nested Android scroll). **Real-device verification on Android is pending** (Product Owner, next build).

## Unverified hypotheses (mitigations kept, cause not proven here)

1. **Pull-to-refresh provider fan-out** — `onRefresh` previously awaited eight `refetch()` calls and then **awaited** `refetchQueries({ queryKey: ["providers"], type: "active" })`. Awaiting network work can keep the refresh spinner visible longer even though it does not by itself block the JS thread.

   **Mitigation (current):** end refresh before scheduling the providers fan-out (`setRefreshing(false)` then `void cache.refetchQueries(...)`); skip `parties.refetch()` when there are no active booking ids.

2. **Nested scroll (Android)** — vertical home `ScrollView` + horizontal promo `ScrollView` without `nestedScrollEnabled` may steal touch responders on Android.

   **Mitigation:** `nestedScrollEnabled` on the promo carousel (Android only).

## Kept hardening

- `useMemo` for `activeIds` so `useBookingParties` query keys stay stable when booking data reference changes but ids do not.
- Focus refresh uses query invalidation (`my-bookings`, `customer-fee-debts`) once per focus — light and intentional.