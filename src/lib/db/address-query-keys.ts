export const ADDRESSES_QUERY_ROOT = 'addresses' as const;
export const ADDRESS_QUERY_ROOT = 'address' as const;
export const DEFAULT_ADDRESS_QUERY_ROOT = 'default-address' as const;

export function addressesQueryKey(userId: string) {
  return [ADDRESSES_QUERY_ROOT, userId] as const;
}

export function addressQueryKey(userId: string, addressId: string) {
  return [ADDRESS_QUERY_ROOT, userId, addressId] as const;
}

export function defaultAddressQueryKey(userId: string) {
  return [DEFAULT_ADDRESS_QUERY_ROOT, userId] as const;
}

/** Ensures different accounts never share the same React Query cache bucket. */
export function addressesQueryKeysAreScopedPerUser(userIdA: string, userIdB: string) {
  return addressesQueryKey(userIdA)[1] !== addressesQueryKey(userIdB)[1];
}
