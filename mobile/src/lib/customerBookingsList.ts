import {
  customerHomeActiveBookingNeedsAction,
  customerHomeActiveBookings,
} from "@shared/home/activeHomeBookings";
import { isPaymentEligibleBookingStatus } from "@/lib/bookingPure";
import { moneyHeld } from "@shared/payments/refundOwed";

type PaymentRow = {
  status?: string | null;
  payment_method_type?: string | null;
  proof_path?: string | null;
};

export type CustomerBookingListRow = {
  id: string;
  status: string;
  start_at: string;
  hasReview?: boolean;
  price_total?: number | null;
  payments?: PaymentRow[] | PaymentRow | null;
};

function latestPayment(booking: CustomerBookingListRow): PaymentRow | null {
  if (!booking.payments) return null;
  if (Array.isArray(booking.payments)) return booking.payments[0] ?? null;
  return booking.payments;
}

export function customerBookingListNeedsPayNow(booking: CustomerBookingListRow): boolean {
  if (!isPaymentEligibleBookingStatus(booking.status)) return false;
  const due = Number(booking.price_total ?? 0);
  if (due <= 0) return false;
  const payment = latestPayment(booking);
  if (!payment) return true;
  return !moneyHeld({
    paymentStatus: payment.status ?? undefined,
    methodType: payment.payment_method_type ?? undefined,
    proofPath: payment.proof_path ?? undefined,
  });
}

export type CustomerBookingActionKey =
  | "bookingDetail.confirmArrival"
  | "bookingDetail.confirmCompletion"
  | "bookings.payNow";

export function customerBookingListActionKey(
  booking: CustomerBookingListRow,
): CustomerBookingActionKey | null {
  if (booking.status === "arrived") return "bookingDetail.confirmArrival";
  if (booking.status === "completion_requested") return "bookingDetail.confirmCompletion";
  if (customerBookingListNeedsPayNow(booking)) return "bookings.payNow";
  return null;
}

export function customerBookingListNeedsHighlight(booking: CustomerBookingListRow): boolean {
  return (
    customerHomeActiveBookingNeedsAction(booking.status) || customerBookingListNeedsPayNow(booking)
  );
}

export function sortUpcomingCustomerBookings<T extends CustomerBookingListRow>(rows: T[]): T[] {
  const activeIds = new Set(customerHomeActiveBookings(rows).map((b) => b.id));
  const rank = (b: T) => {
    if (!activeIds.has(b.id)) return 2;
    return customerBookingListNeedsHighlight(b) ? 0 : 1;
  };
  return [...rows].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return +new Date(a.start_at) - +new Date(b.start_at);
  });
}

export function latestCompletedBookingWithoutReview<T extends CustomerBookingListRow>(
  bookings: readonly T[],
): T | null {
  return bookings.find((b) => b.status === "completed" && !b.hasReview) ?? null;
}