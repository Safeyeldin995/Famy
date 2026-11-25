import {
  customerHomeActiveBookingNeedsAction,
  customerHomeActiveBookings,
} from "@shared/home/activeHomeBookings";
import { isPaymentEligibleBookingStatus } from "@/lib/bookingPure";
import { moneyHeld } from "@shared/payments/refundOwed";
import {
  pickCurrentBookingPayment,
  type BookingPaymentRow,
} from "@shared/payments/currentBookingPayment";

type PaymentRow = BookingPaymentRow;

export type CustomerBookingListRow = {
  id: string;
  status: string;
  start_at: string;
  end_at?: string | null;
  completed_at?: string | null;
  hasReview?: boolean;
  price_total?: number | null;
  payments?: PaymentRow[] | PaymentRow | null;
};

function latestPayment(booking: CustomerBookingListRow): PaymentRow | null {
  return pickCurrentBookingPayment(booking.payments);
}

export function customerBookingListNeedsPayNow(booking: CustomerBookingListRow): boolean {
  if (!isPaymentEligibleBookingStatus(booking.status)) return false;
  const due = Number(booking.price_total ?? 0);
  if (due <= 0) return false;
  const payment = latestPayment(booking);
  if (!payment) return true;
  // Cash is paid to the provider at the visit: nothing to pay in the app.
  if (payment.payment_method_type === "cash") return false;
  if (payment.status === "captured" || payment.status === "partially_refunded") return false;
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

/** How long after a booking ends Home keeps asking for a rating. */
export const RATE_PROMPT_WINDOW_DAYS = 14;

export function latestCompletedBookingWithoutReview<T extends CustomerBookingListRow>(
  bookings: readonly T[],
  options: { now?: Date; dismissedIds?: ReadonlySet<string> } = {},
): T | null {
  const now = +(options.now ?? new Date());
  const windowMs = RATE_PROMPT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return (
    bookings.find((b) => {
      if (b.status !== "completed" || b.hasReview) return false;
      if (options.dismissedIds?.has(b.id)) return false;
      const finished = +new Date(b.completed_at ?? b.end_at ?? b.start_at);
      return Number.isFinite(finished) && now - finished <= windowMs;
    }) ?? null
  );
}
