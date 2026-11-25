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

  it("prefers a paid attempt over a newer pending one", () => {
    const payment = pickCurrentBookingPayment([
      { status: "captured", payment_method_type: "online", created_at: "2026-01-02T09:00:00Z" },
      { status: "pending", payment_method_type: "online", created_at: "2026-01-02T12:00:00Z" },
    ]);
    expect(payment?.status).toBe("captured");
  });

  it("prefers an InstaPay receipt in review over a newer pending attempt", () => {
    const payment = pickCurrentBookingPayment([
      {
        status: "pending_review",
        payment_method_type: "manual_transfer",
        proof_path: "u/receipt.jpg",
        created_at: "2026-01-02T09:00:00Z",
      },
      { status: "pending", payment_method_type: "online", created_at: "2026-01-02T12:00:00Z" },
    ]);
    expect(payment?.status).toBe("pending_review");
  });

  it("falls back to the newest attempt when nothing is paid", () => {
    const payment = pickCurrentBookingPayment([
      { status: "pending", payment_method_type: "online", created_at: "2026-01-02T09:00:00Z" },
      {
        status: "pending_review",
        payment_method_type: "manual_transfer",
        proof_path: null,
        created_at: "2026-01-02T12:00:00Z",
      },
    ]);
    expect(payment?.created_at).toBe("2026-01-02T12:00:00Z");
  });
});
