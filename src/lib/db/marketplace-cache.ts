import type { QueryClient } from '@tanstack/react-query';

/** Customer marketplace queries that must refresh after Admin eligibility changes. */
export function invalidateCustomerMarketplaceQueries(qc: QueryClient, providerId?: string) {
  qc.invalidateQueries({ queryKey: ['providers'] });
  qc.invalidateQueries({ queryKey: ['marketplace-services'] });
  if (providerId) {
    qc.invalidateQueries({ queryKey: ['provider', providerId] });
    qc.invalidateQueries({ queryKey: ['provider-services', providerId] });
    qc.invalidateQueries({ queryKey: ['available-slots', providerId] });
    qc.invalidateQueries({ queryKey: ['provider-booking-settings', providerId] });
    return;
  }
  qc.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return root === 'provider' || root === 'provider-services' || root === 'available-slots' || root === 'provider-booking-settings';
    },
  });
}

/** Cross-tab refresh when Admin and Customer sessions are separate browsers. */
export const CUSTOMER_MARKETPLACE_REFETCH_MS = 5_000;

/** Poll only while the tab is visible; marketplace search/detail routes mount these hooks. */
export function customerMarketplaceRefetchInterval() {
  if (typeof document !== 'undefined' && document.hidden) return false;
  return CUSTOMER_MARKETPLACE_REFETCH_MS;
}
