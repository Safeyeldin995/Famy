import { describe, expect, it } from "vitest";
import { buildBookingRequest } from "@/lib/booking/bookingRequest";

describe("online web lesson request payload", () => {
  it("creates an online booking without address", () => {
    const start = new Date("2026-12-01T16:00:00.000Z");
    const end = new Date("2026-12-01T17:00:00.000Z");
    const payload = buildBookingRequest({
      providerId: "provider-1",
      serviceId: "service-1",
      addressId: null,
      serviceMode: "online",
      forWhom: "myself",
      start,
      end,
      promoStatus: "none",
      appliedPromoId: null,
      notes: "algebra",
      eitherRequirements: [],
      requirementChoices: {},
      selectedCapability: null,
      supervisionMode: null,
    });
    expect(payload.service_mode).toBe("online");
    expect(payload.address_id).toBeNull();
  });
});