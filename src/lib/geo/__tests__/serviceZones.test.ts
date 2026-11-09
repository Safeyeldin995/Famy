import { describe, expect, it } from "vitest";
import {
  areaNameForZone,
  pointInZone,
  zoneCenter,
  zoneForAreaName,
  zoneForPoint,
  type ServiceZone,
} from "../serviceZones";

// Shapes from Production (rounded).
const zayed: ServiceZone = {
  id: "z",
  name_en: "Sheikh Zayed",
  name_ar: "الشيخ زايد",
  boundary_type: "polygon",
  polygon: [
    { lat: 30.0685, lng: 30.9325 },
    { lat: 30.0881, lng: 30.9723 },
    { lat: 30.0391, lng: 31.0383 },
    { lat: 30.0097, lng: 30.982 },
  ],
  center_lat: null,
  center_lng: null,
  radius_km: null,
};
const october: ServiceZone = {
  id: "o",
  name_en: "6th of october",
  name_ar: "السادس من اكتوبر",
  boundary_type: "polygon",
  polygon: [
    { lat: 29.9426, lng: 30.9199 },
    { lat: 29.9813, lng: 30.8676 },
    { lat: 30.0322, lng: 30.9597 },
    { lat: 29.9741, lng: 31.0041 },
  ],
  center_lat: null,
  center_lng: null,
  radius_km: null,
};
const zones = [zayed, october];
const maadi = { lat: 29.9602, lng: 31.2569 };

describe("service zones", () => {
  it("finds the zone that contains a pin", () => {
    expect(zoneForPoint({ lat: 30.05, lng: 30.98 }, zones)?.id).toBe("z");
    expect(zoneForPoint({ lat: 29.98, lng: 30.94 }, zones)?.id).toBe("o");
  });

  it("rejects a pin outside every zone (Maadi)", () => {
    expect(zoneForPoint(maadi, zones)).toBeNull();
  });

  it("puts each zone centre inside its own zone", () => {
    for (const z of zones) expect(pointInZone(zoneCenter(z)!, z)).toBe(true);
  });

  it("supports circle zones", () => {
    const circle: ServiceZone = {
      ...zayed,
      id: "c",
      boundary_type: "circle",
      polygon: null,
      center_lat: 30.0444,
      center_lng: 31.2357,
      radius_km: "10",
    };
    expect(pointInZone(maadi, circle)).toBe(true);
    expect(pointInZone({ lat: 30.05, lng: 30.98 }, circle)).toBe(false);
  });

  it("picks the nearest containing circle when circles overlap", () => {
    const circle = (id: string, lat: number, lng: number): ServiceZone => ({
      ...zayed,
      id,
      boundary_type: "circle",
      polygon: null,
      center_lat: lat,
      center_lng: lng,
      radius_km: 20,
    });
    const far = circle("far", 30.1, 31.35);
    const near = circle("near", 29.97, 31.26);
    expect(zoneForPoint(maadi, [far, near])?.id).toBe("near");
  });

  it("matches service-area names to zones ignoring case", () => {
    const areas = ["Sheikh Zayed", "6th of October"];
    expect(zoneForAreaName("6th of October", zones)?.id).toBe("o");
    expect(areaNameForZone(october, areas)).toBe("6th of October");
    expect(areaNameForZone(zayed, areas)).toBe("Sheikh Zayed");
  });
});
