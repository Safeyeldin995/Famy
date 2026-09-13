import { describe, expect, it } from "vitest";
import { isValidLatLng, toLatLng } from "@/lib/geo/latLng";

describe("isValidLatLng", () => {
  it("accepts a real Cairo coordinate", () => {
    expect(isValidLatLng({ lat: 30.0444, lng: 31.2357 })).toBe(true);
  });

  it("accepts the equator/prime meridian origin", () => {
    expect(isValidLatLng({ lat: 0, lng: 0 })).toBe(true);
  });

  it("rejects null and undefined", () => {
    expect(isValidLatLng(null)).toBe(false);
    expect(isValidLatLng(undefined)).toBe(false);
  });

  it("rejects NaN, which is what a missing database column becomes", () => {
    expect(isValidLatLng({ lat: NaN, lng: 31.2357 })).toBe(false);
    expect(isValidLatLng({ lat: 30.0444, lng: NaN })).toBe(false);
  });

  it("rejects infinities", () => {
    expect(isValidLatLng({ lat: Infinity, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: -Infinity })).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(isValidLatLng({ lat: 90.1, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: -90.1, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: 180.1 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: -180.1 })).toBe(false);
  });

  it("accepts the exact range boundaries", () => {
    expect(isValidLatLng({ lat: 90, lng: 180 })).toBe(true);
    expect(isValidLatLng({ lat: -90, lng: -180 })).toBe(true);
  });
});

describe("toLatLng", () => {
  it("returns null for an address row with no pin", () => {
    expect(toLatLng(null, null)).toBeNull();
    expect(toLatLng(undefined, undefined)).toBeNull();
  });

  it("returns null when only one coordinate is present", () => {
    expect(toLatLng(30.0444, null)).toBeNull();
    expect(toLatLng(null, 31.2357)).toBeNull();
  });

  it("returns the pair when both are present and valid", () => {
    expect(toLatLng(30.0444, 31.2357)).toEqual({ lat: 30.0444, lng: 31.2357 });
  });
});
