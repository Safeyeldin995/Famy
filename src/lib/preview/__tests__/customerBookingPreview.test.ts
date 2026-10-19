import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { seedCustomerBookingPreview, bookingPreviewServices } from "../customerBookingPreview";
import { filterFixedStartSlots } from "@/lib/pricing/servicePackages";

it("seeds live booking query keys for hourly, packages and tutoring on all 14 dates", () => {
  const qc = new QueryClient();
  seedCustomerBookingPreview(qc, {});
  expect(qc.getQueryData(["family-members", "active"])).toHaveLength(1);
  expect(qc.getQueryData(["provider-services", "p1"])).toHaveLength(4);
  for (const service of bookingPreviewServices) {
    expect(qc.getQueryData(["service-requirements", service.id])).toEqual([]);
    expect(
      qc.getQueryData(["provider-booking-settings", "p1", service.id, "addr-1"]),
    ).toBeDefined();
    for (let index = 0; index < 14; index++) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() + index);
      const slots = qc.getQueryData<{ start: Date; end: Date }[]>([
        "available-slots",
        "p1",
        day.toDateString(),
        service.duration_min,
        service.id,
        "addr-1",
        service.pricing_model === "fixed",
        service.fixed_start_time,
      ]);
      expect(slots).toBeDefined();
      expect(filterFixedStartSlots(slots ?? [], service)).toEqual(slots);
      if (index === 1) expect(slots?.length).toBeGreaterThan(0);
      if (index === 3) expect(slots).toEqual([]);
    }
  }
  expect(
    qc.getQueryData(["approved-teaching-capabilities", "p1", "booking-tutoring"]),
  ).toHaveLength(2);
});
