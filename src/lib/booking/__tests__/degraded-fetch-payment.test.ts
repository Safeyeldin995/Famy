import { describe, expect, it, vi } from "vitest";
import { completeCreateBookingResult } from "@/lib/booking/create-booking-result";
import { planPostCreatePayment } from "@/lib/booking/post-create-payment";

const selectedMethod = {
  id: "method-1",
  method_type: "cash" as const,
};

describe("degraded booking fetch payment flow", () => {
  it("does not plan wizard payment creation when post-create SELECT fails", async () => {
    const rpcPayload = {
      booking_id: "99999999-9999-9999-9999-999999999999",
      created: true,
      idempotent_replay: false,
    };
    const fetchBooking = vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const booking = await completeCreateBookingResult(rpcPayload, fetchBooking, { retryDelayMs: 0 });
    const plan = planPostCreatePayment(booking, selectedMethod);

    expect(booking.fetch_degraded).toBe(true);
    expect(plan.action).toBe("defer");
    expect(plan).toMatchObject({
      bookingId: rpcPayload.booking_id,
      paymentMethodId: selectedMethod.id,
    });
  });

  it("plans immediate payment only with authoritative booking data", async () => {
    const bookingRow = {
      id: "99999999-9999-9999-9999-999999999999",
      price_total: 253,
      fetch_degraded: undefined,
    };
    const plan = planPostCreatePayment(bookingRow, selectedMethod);
    expect(plan.action).toBe("create_now");
  });
});
