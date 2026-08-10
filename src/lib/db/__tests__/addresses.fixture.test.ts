import { describe, expect, it, vi } from "vitest";
import { assertProviderBookingEligibility } from "@/lib/booking/__tests__/booking.harness";

describe("address fixture booking eligibility contract", () => {
  it("assertProviderBookingEligibility passes when marketplace_eligibility_internal reports eligible", async () => {
    const admin = {
      rpc: vi.fn(async (name, args) => {
        expect(name).toBe("marketplace_eligibility_internal");
        expect(args).toEqual({
          p_provider_id: "provider-1",
          p_service_id: "service-1",
          p_address_id: "address-1",
        });
        return { data: [{ is_eligible: true }], error: null };
      }),
    };

    await expect(assertProviderBookingEligibility(
      admin as never,
      "provider-1",
      "service-1",
      "address-1",
    )).resolves.toBeUndefined();
  });

  it("assertProviderBookingEligibility throws BOOKING_PROVIDER_INELIGIBLE when not eligible", async () => {
    const admin = {
      rpc: vi.fn(async () => ({
        data: [{ is_eligible: false, reason_code: "provider_not_approved" }],
        error: null,
      })),
    };

    await expect(assertProviderBookingEligibility(
      admin as never,
      "provider-1",
      "service-1",
      "address-1",
    )).rejects.toThrow(/BOOKING_PROVIDER_INELIGIBLE/);
  });
});
