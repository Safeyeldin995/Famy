# Customer home “stopping” — evidence

## Investigated (and rejected): unstable `bookings.refetch` in `useFocusEffect`

TanStack Query v5 exposes `refetch` from `useQuery` with a **stable** function identity across renders when the observer is unchanged ([`useBaseQuery`](https://github.com/TanStack/query/blob/main/packages/react-query/src/useBaseQuery.ts)). Unit guard: `mobile/src/ui/__tests__/homeFocusEvidence.test.ts`.

Adding `bookings.refetch` to `useFocusEffect` deps therefore does **not** explain a refetch storm on every render while Home is focused.

## Supported causes

1. **Pull-to-refresh main-thread load** — `onRefresh` awaited eight `refetch()` calls, then **awaited** `refetchQueries({ queryKey: ["providers"], type: "active" })`, which fans out to every mounted providers query (including `NearbyProviders` ×2). On Android, holding the refresh spinner until that fan-out completes keeps the JS thread busy; rapid taps feel like the screen “stopped”.

   **Fix:** skip `parties.refetch()` when there are no active booking ids; end refresh **before** scheduling the providers fan-out (`setRefreshing(false)` then `void cache.refetchQueries(...)`).

2. **Nested scroll (Android)** — vertical home `ScrollView` + horizontal promo `ScrollView` without `nestedScrollEnabled` can steal touch responders ([RN nested scrolling](https://reactnative.dev/docs/scrollview#nestedscrollenabled-android)).

   **Fix:** `nestedScrollEnabled` on the promo carousel (Android only).

## Kept hardening

- `useMemo` for `activeIds` so `useBookingParties` query keys stay stable when booking data reference changes but ids do not.
- Focus refresh uses query invalidation (`my-bookings`, `customer-fee-debts`) once per focus — light and intentional.