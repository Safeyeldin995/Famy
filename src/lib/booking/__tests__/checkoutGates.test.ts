import { describe, expect, it } from "vitest";
import {
  checkoutAddressOutsideArea,
  checkoutAddressReady,
  checkoutContinueBlocked,
  checkoutEligibilityServiceId,
  checkoutProviderServesAddress,
} from "../checkoutGates";

const bookableMap = (ids: string[]) => new Map(ids.map((id) => [id, null]));

describe("checkoutGates", () => {
  it("keeps the route service id while bookable catches up to a new address", () => {
    expect(checkoutEligibilityServiceId("svc-route", undefined)).toBe("svc-route");
    expect(checkoutEligibilityServiceId("", "svc-resolved")).toBe("svc-resolved");
  });

  it("reports provider coverage from bookable services for the active address", () => {
    const ready = {
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: true,
      data: bookableMap(["svc-a", "svc-b"]),
    };
    expect(checkoutProviderServesAddress(ready, "svc-b")).toBe(true);
    expect(checkoutProviderServesAddress(ready, "svc-missing")).toBe(false);

    const pending = { ...ready, isSuccess: false, isFetching: true, data: undefined };
    expect(checkoutProviderServesAddress(pending, "svc-b")).toBe(null);
  });

  it("re-enables continue after covered → uncovered → covered address switches", () => {
    const covered = {
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: true,
      data: bookableMap(["svc-1"]),
    };
    const uncovered = {
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: true,
      data: bookableMap([]),
    };
    const refetching = {
      isError: false,
      isFetching: true,
      isLoading: true,
      isSuccess: false,
      data: undefined,
    };
    const settings = {
      isError: false,
      isFetching: false,
      isLoading: false,
      data: { max_advance_days: 12 },
    };
    const settingsNull = { ...settings, data: null };
    const packageRate = {
      isError: false,
      isFetching: false,
      isLoading: false,
      data: 250,
    };
    const base = {
      servicesError: false,
      billingError: false,
      quoteTotal: 481,
      hasService: true,
      needsRate: false,
      packageRate,
      capsError: false,
      addressId: "addr-b",
      serviceId: "svc-1",
    };

    expect(
      checkoutContinueBlocked({
        ...base,
        bookable: uncovered,
        settings: settingsNull,
      }),
    ).toBe(true);
    expect(
      checkoutContinueBlocked({
        ...base,
        bookable: refetching,
        settings: { ...settings, isFetching: true, isLoading: true, data: undefined },
      }),
    ).toBe(false);
    expect(
      checkoutAddressReady({
        addressId: "addr-b",
        hasPinnedAddress: true,
        bookable: refetching,
        serviceId: "svc-1",
      }),
    ).toBe(false);
    expect(
      checkoutContinueBlocked({
        ...base,
        bookable: covered,
        settings,
      }),
    ).toBe(false);
    expect(
      checkoutAddressReady({
        addressId: "addr-b",
        hasPinnedAddress: true,
        bookable: covered,
        serviceId: "svc-1",
      }),
    ).toBe(true);
    expect(
      checkoutAddressOutsideArea({
        addressId: "addr-a",
        hasPinnedAddress: true,
        bookable: uncovered,
        serviceId: "svc-1",
      }),
    ).toBe(true);
    expect(
      checkoutAddressOutsideArea({
        addressId: "addr-b",
        hasPinnedAddress: true,
        bookable: covered,
        serviceId: "svc-1",
      }),
    ).toBe(false);
  });
});
