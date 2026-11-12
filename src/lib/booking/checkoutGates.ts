export type CheckoutBookableQuery = {
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  data?: Map<string, unknown> | null | undefined;
};

export type CheckoutSettingsQuery = {
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  data?: unknown;
};

export type CheckoutRateQuery = {
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  data?: unknown;
};

/** Keep eligibility queries stable while the filtered service list catches up to a new address. */
export function checkoutEligibilityServiceId(
  routeServiceId: string | null | undefined,
  resolvedServiceId: string | null | undefined,
): string | null {
  const id = resolvedServiceId || routeServiceId || null;
  return id ? id : null;
}

/** null = still resolving for the current address; false = provider does not serve this address. */
export function checkoutProviderServesAddress(
  bookable: CheckoutBookableQuery,
  serviceId: string | null,
): boolean | null {
  if (bookable.isError) return false;
  if (bookable.isFetching || bookable.isLoading || !bookable.isSuccess) return null;
  if (bookable.data == null) return null;
  if (!serviceId) return bookable.data.size > 0;
  return bookable.data.has(serviceId);
}

export function checkoutAddressReady(input: {
  addressId: string | null | undefined;
  hasPinnedAddress: boolean;
  bookable: CheckoutBookableQuery;
  serviceId: string | null;
}): boolean {
  if (!input.hasPinnedAddress || !input.addressId) return false;
  const serves = checkoutProviderServesAddress(input.bookable, input.serviceId);
  if (serves !== true) return false;
  return true;
}

export function checkoutAddressOutsideArea(input: {
  addressId: string | null | undefined;
  hasPinnedAddress: boolean;
  bookable: CheckoutBookableQuery;
  serviceId: string | null;
}): boolean {
  if (!input.addressId || !input.hasPinnedAddress) return false;
  const serves = checkoutProviderServesAddress(input.bookable, input.serviceId);
  return serves === false;
}

export function checkoutContinueBlocked(input: {
  servicesError: boolean;
  bookable: CheckoutBookableQuery;
  settings: CheckoutSettingsQuery;
  billingError: boolean;
  quoteTotal: number;
  hasService: boolean;
  needsRate: boolean;
  packageRate: CheckoutRateQuery;
  capsError: boolean;
  addressId: string | null | undefined;
  serviceId: string | null;
}): boolean {
  if (input.servicesError || input.billingError || input.capsError) return true;
  if (input.bookable.isError || input.settings.isError) return true;
  if (input.needsRate && input.packageRate.isError) return true;

  const addressQueriesPending =
    !!input.addressId &&
    (input.bookable.isFetching ||
      input.bookable.isLoading ||
      input.settings.isFetching ||
      input.settings.isLoading);
  if (addressQueriesPending) return false;

  if (input.needsRate && (input.packageRate.isLoading || input.packageRate.isFetching)) return false;

  const serves = checkoutProviderServesAddress(input.bookable, input.serviceId);
  if (input.addressId && serves === false) return true;
  if (input.addressId && serves === true && !input.settings.data) return true;

  if (!input.hasService) return true;
  if (!Number.isFinite(input.quoteTotal)) return true;
  if (input.needsRate && input.packageRate.data == null) return true;

  return false;
}
