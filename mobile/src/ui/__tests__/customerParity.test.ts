import { describe, expect, it } from "vitest";
import { uniqueProviders } from "@/lib/presentation";
import type { Provider } from "@/lib/queries";
import { bookingStatusStyle } from "@/ui/customer/bookingStatusStyle";
import { customerMoney } from "@/lib/customerFormat";
import { mapDocument, parseMapMessage } from "@/ui/customer/mapDocument";
import {
  customerNotificationDate,
  customerNotificationGroups,
} from "@/lib/customerNotificationGroups";

describe("customer list parity", () => {
  it("validates map messages and never interpolates unchecked coordinates", () => {
    expect(parseMapMessage('{"type":"center","lat":30,"lng":31}')).toEqual({ lat: 30, lng: 31 });
    expect(parseMapMessage('{"type":"center","lat":999,"lng":31}')).toBeNull();
    expect(parseMapMessage('{"type":"center","lat":"30","lng":31}')).toBeNull();
    expect(parseMapMessage("invalid")).toBeNull();
    expect(() => mapDocument({ lat: NaN, lng: 31 }, true)).toThrow("invalid_map_center");
    expect(mapDocument({ lat: 30, lng: 31 }, true)).toContain("integrity=");
    expect(mapDocument({ lat: 30, lng: 31 }, false)).not.toContain("map.on('moveend'");
  });
  it("uses the same Latin-digit currency strings as the web customer cards", () => {
    expect(customerMoney(1250, "ar")).toBe("1,250 ج.م");
    expect(customerMoney(150, "ar", true)).toBe("150 ج.م/س");
    expect(customerMoney(150, "en", true)).toBe("EGP 150/hr");
  });
  it("uses grey confirmed pills and web lifecycle tones", () => {
    for (const status of ["confirmed", "on_the_way", "arrived", "arrival_confirmed", "in_progress"])
      expect(bookingStatusStyle(status)).toEqual({
        backgroundColor: "#2A1E251A",
        color: "#2A1E25",
      });
    expect(bookingStatusStyle("pending").color).toBe("#F10E72");
    expect(bookingStatusStyle("completed").color).toBe("#1F9D63");
    expect(bookingStatusStyle("cancelled").color).toBe("#6F6168");
  });
  it("keeps both services on a dual-service provider without mutating query rows", () => {
    const row = (id: string, service: string) =>
      ({ id, services: [{ service: { id: service } }] }) as Provider;
    const first = row("dual", "babysitting");
    const other = row("other", "tutoring");
    const result = uniqueProviders([
      first,
      other,
      row("dual", "tutoring"),
      row("dual", "babysitting"),
    ]);
    expect(result.map((p) => p.id)).toEqual(["dual", "other"]);
    expect(result[0].services.map((p) => p.service.id)).toEqual(["babysitting", "tutoring"]);
    expect(first.services).toHaveLength(1);
  });
  it("sorts and groups at Cairo midnight, without mutating the input", () => {
    const rows = [{ created_at: "2026-01-01T21:30:00Z" }, { created_at: "2026-01-01T22:30:00Z" }];
    const groups = customerNotificationGroups(rows, new Date("2026-01-01T23:00:00Z"));
    expect(groups.map((g) => g.labelKey)).toEqual([
      "customerRound2.notificationToday",
      "customerRound2.notificationYesterday",
    ]);
    expect(groups[0].items).toEqual([rows[1]]);
    expect(rows[0].created_at).toBe("2026-01-01T21:30:00Z");
  });
  it("uses calendar subtraction across the Cairo DST transition", () => {
    const groups = customerNotificationGroups(
      [{ created_at: "2026-10-29T09:00:00Z" }],
      new Date("2026-10-30T09:00:00Z"),
    );
    expect(groups[0].labelKey).toBe("customerRound2.notificationYesterday");
  });
  it("formats Arabic notification time with Latin digits", () => {
    const text = customerNotificationDate(new Date("2026-01-01T09:05:00Z"), "ar", true);
    expect(text).toContain("11:05");
    expect(text).not.toMatch(/[٠-٩۰-۹]/);
  });
});
