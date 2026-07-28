import { describe, expect, it, vi } from "vitest";
import { mapPaymentInsertError } from "../payment-queries";

describe("mapPaymentInsertError", () => {
  it("maps known trigger and ownership failures", () => {
    expect(mapPaymentInsertError(new Error("Payment amount must match the booking total (123 vs 456)")))
      .toBe("Payment amount does not match the booking total.");
    expect(mapPaymentInsertError(new Error("Payment customer does not match booking owner")))
      .toBe("You cannot record payment for this booking.");
    expect(mapPaymentInsertError(new Error("Booking not found for this payment")))
      .toBe("Booking not found for this payment.");
  });

  it("returns generic message for unknown errors and logs internally", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(mapPaymentInsertError(new Error("23505 duplicate key value violates unique constraint")))
      .toBe("Could not record payment method");
    expect(spy).toHaveBeenCalledWith(
      "[payment.insert] unmapped error:",
      "23505 duplicate key value violates unique constraint",
      expect.any(Error),
    );
    spy.mockRestore();
  });
});
