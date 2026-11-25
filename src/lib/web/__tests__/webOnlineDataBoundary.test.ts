import { describe, expect, it } from "vitest";
import {
  assertWebOnlineBookingRow,
  filterWebOnlineBookingRows,
  redactInPersonFieldsForWeb,
} from "../webOnlineDataBoundary";

describe("webOnlineDataBoundary", () => {
  it("rejects in-person bookings for web (list and direct id)", () => {
    const mixed = [
      { id: "on-1", service_mode: "online" },
      { id: "ip-1", service_mode: "in_person" },
    ];
    expect(filterWebOnlineBookingRows(mixed)).toEqual([{ id: "on-1", service_mode: "online" }]);
    expect(assertWebOnlineBookingRow({ service_mode: "in_person" })).toEqual({
      ok: false,
      code: "not_online_booking",
    });
    expect(assertWebOnlineBookingRow({ service_mode: "online" })).toEqual({ ok: true });
  });

  it("redacts in-person address and private contact fields from web payloads", () => {
    const row = {
      id: "on-1",
      service_mode: "online",
      full_address: "should not leak",
      private_phone: "+201234567890",
      start_at: "2026-11-24T10:00:00Z",
    };
    expect(redactInPersonFieldsForWeb(row)).toEqual({
      id: "on-1",
      service_mode: "online",
      start_at: "2026-11-24T10:00:00Z",
    });
  });
});