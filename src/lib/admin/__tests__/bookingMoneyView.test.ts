import { describe, expect, it } from "vitest";
import { bookingMoneyView } from "../bookingMoneyView";
import type {
  AdminBookingMoneySummary,
  AdminMoneyPayment,
} from "@/lib/db/admin-wallet-ops-queries";

function payment(p: Partial<AdminMoneyPayment>): AdminMoneyPayment {
  return {
    id: "p1",
    status: "captured",
    method_type: "online",
    method: "card",
    amount: 300,
    funded_total: 350,
    wallet_applied: 50,
    wallet_released: 0,
    refund_amount: 0,
    refund_channel: null,
    refund_reference: null,
    wallet_refunded_total: 0,
    gateway_refunded: 0,
    gateway_refund_unknown: false,
    captured_at: "2026-11-26T10:00:00Z",
    created_at: "2026-11-26T09:00:00Z",
    ...p,
  };
}

function summary(s: Partial<AdminBookingMoneySummary>): AdminBookingMoneySummary {
  return {
    booking_id: "b1",
    status: "completed",
    service_mode: "online",
    price_total: 350,
    price_discount: 0,
    carried_fees_amount: 0,
    commission_amount: 70,
    commission_percent: 20,
    provider_net: 280,
    payments: [],
    wallet_entries: [],
    provider_ledger: [],
    refund_terms: {
      booking_id: "b1",
      customer_id: "c1",
      booking_status: "completed",
      mode: "completed",
      payment_id: "p1",
      payment_status: "captured",
      payment_method_type: "online",
      funded_total: 350,
      already_refunded: 0,
      card_refunded: 0,
      cancellation_fee: 0,
      carried_fees: 0,
      max_refundable: 350,
      blocked: null,
    },
    ...s,
  };
}

describe("bookingMoneyView", () => {
  it("shows the funded total, the wallet part and wallet refunds", () => {
    const view = bookingMoneyView(
      summary({
        payments: [
          payment({ id: "old", status: "failed", created_at: "2026-11-26T08:00:00Z" }),
          payment({}),
        ],
        wallet_entries: [
          {
            id: "w1",
            direction: "debit",
            amount: 50,
            reason: "checkout_spend",
            created_at: "x",
            admin_name: null,
            note: null,
          },
          {
            id: "w2",
            direction: "credit",
            amount: 100,
            reason: "admin_lesson_refund",
            created_at: "x",
            admin_name: "Admin",
            note: "n",
          },
        ],
      }),
    );
    expect(view.payment?.id).toBe("p1");
    expect(view.paid).toBe(350);
    expect(view.walletApplied).toBe(50);
    expect(view.refunded).toBe(100);
    expect(view.isCash).toBe(false);
  });

  it("treats a cash-only booking as paid to the tutor, not held by Famy", () => {
    const view = bookingMoneyView(
      summary({
        payments: [payment({ method_type: "cash", status: "pending", funded_total: 350 })],
      }),
    );
    expect(view.isCash).toBe(true);
    expect(view.paid).toBe(0);
  });

  it("counts a card refund and the fee credited to the tutor", () => {
    const view = bookingMoneyView(
      summary({
        status: "cancelled",
        payments: [
          payment({
            status: "partially_refunded",
            refund_amount: 300,
            refund_reference: "PM-1",
            refund_channel: null,
          }),
        ],
        provider_ledger: [
          {
            kind: "cancellation_fee_provider_share",
            direction: "credit",
            amount: 50,
            created_at: "x",
          },
        ],
      }),
    );
    expect(view.refunded).toBe(300);
    expect(view.feeToTutor).toBe(50);
  });

  it("shows a refund made in Paymob on its own line", () => {
    const view = bookingMoneyView(summary({ payments: [payment({ gateway_refunded: 120 })] }));
    expect(view.cardRefunded).toBe(120);
    expect(view.refunded).toBe(0);
  });

  it("shows nothing paid when the only attempt failed", () => {
    const view = bookingMoneyView(summary({ payments: [payment({ status: "failed" })] }));
    expect(view.paid).toBe(0);
    expect(view.payment?.status).toBe("failed");
  });
});
