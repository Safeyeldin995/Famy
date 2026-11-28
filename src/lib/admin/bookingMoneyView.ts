import type {
  AdminBookingMoneySummary,
  AdminMoneyPayment,
} from "@/lib/db/admin-wallet-ops-queries";

const HELD = new Set(["captured", "partially_refunded", "refunded"]);

export type BookingMoneyView = {
  /** The payment that funded the booking (or the latest attempt if none did). */
  payment: AdminMoneyPayment | null;
  /** Paid at the visit in cash: Famy holds nothing. */
  isCash: boolean;
  /** What the customer actually paid through Famy (card / transfer + wallet part). */
  paid: number;
  walletApplied: number;
  /** Returned to the customer (card refund, wallet refund, automatic refunds). */
  refunded: number;
  /** Returned to the card by Paymob (refund made in Paymob, reported by its webhook). */
  cardRefunded: number;
  /** Cancellation / no-show fees credited to the tutor. */
  feeToTutor: number;
};

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function bookingMoneyView(data: AdminBookingMoneySummary): BookingMoneyView {
  const payments = data.payments ?? [];
  const funding =
    payments.find((p) => HELD.has(p.status) && p.method_type !== "cash") ??
    [...payments].reverse().find((p) => p.method_type !== "cash") ??
    null;
  const isCash = !funding && payments.some((p) => p.method_type === "cash");

  const paid = funding && HELD.has(funding.status) ? n(funding.funded_total) : 0;
  const walletApplied = funding && HELD.has(funding.status) ? n(funding.wallet_applied) : 0;

  const walletRefunds = (data.wallet_entries ?? [])
    .filter(
      (e) =>
        e.direction === "credit" &&
        [
          "provider_cancelled",
          "customer_cancelled_refund",
          "online_no_show_refund",
          "admin_lesson_refund",
        ].includes(e.reason),
    )
    .reduce((sum, e) => sum + n(e.amount), 0);
  // A card refund recorded by reference is not in the wallet.
  const cardRefunds = payments
    .filter((p) => p.refund_reference && p.refund_channel !== "customer_wallet")
    .reduce((sum, p) => sum + n(p.refund_amount), 0);

  const cardRefunded = payments.reduce((sum, p) => sum + n(p.gateway_refunded), 0);

  const feeToTutor = (data.provider_ledger ?? [])
    .filter((l) => l.kind === "cancellation_fee_provider_share" && l.direction === "credit")
    .reduce((sum, l) => sum + n(l.amount), 0);

  return {
    payment: funding,
    isCash,
    paid,
    walletApplied,
    refunded: walletRefunds + cardRefunds,
    cardRefunded,
    feeToTutor,
  };
}
