import { describe, expect, it } from "vitest";
import { pickCurrentBookingPayment } from "../currentBookingPayment";

describe("pickCurrentBookingPayment", () => {
  it("ignores rejected attempts and returns the newest relevant row", () => {
    const payment = pickCurrentBookingPayment([
      {
        status: "rejected",
        created_at: "2026-01-02T10:00:00Z",
      },
      {
        status: "captured",
        created_at: "2026-01-02T11:00:00Z",
        payment_method_type: "card",
      },
      {
        status: "pending",
        created_at: "2026-01-02T09:00:00Z",
      },
    ]);
    expect(payment?.status).toBe("captured");
  });
});