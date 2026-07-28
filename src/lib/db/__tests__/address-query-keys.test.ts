import { describe, expect, it } from "vitest";
import {
  ADDRESSES_QUERY_ROOT,
  ADDRESS_QUERY_ROOT,
  addressQueryKey,
  addressesQueryKey,
  addressesQueryKeysAreScopedPerUser,
  defaultAddressQueryKey,
} from "../address-query-keys";

describe("address query keys", () => {
  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";
  const addressId = "33333333-3333-3333-3333-333333333333";

  it("scopes list queries by user id", () => {
    expect(addressesQueryKey(userA)).toEqual([ADDRESSES_QUERY_ROOT, userA]);
    expect(addressesQueryKey(userB)).toEqual([ADDRESSES_QUERY_ROOT, userB]);
    expect(addressesQueryKeysAreScopedPerUser(userA, userB)).toBe(true);
  });

  it("scopes single-address queries by user id and address id", () => {
    expect(addressQueryKey(userA, addressId)).toEqual([ADDRESS_QUERY_ROOT, userA, addressId]);
    expect(addressQueryKey(userB, addressId)[1]).not.toBe(userA);
  });

  it("scopes default-address queries by user id", () => {
    expect(defaultAddressQueryKey(userA)[1]).toBe(userA);
    expect(defaultAddressQueryKey(userB)[1]).toBe(userB);
  });
});
