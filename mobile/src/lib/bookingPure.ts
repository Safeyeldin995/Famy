// Recovery from src/lib/booking/create-booking-result.ts; web client factory omitted.
export type CreateBookingRpcPayload = {
  booking_id: string;
  created: boolean;
  idempotent_replay: boolean;
};

export type CompletedCreateBookingResult = Record<string, unknown> & {
  id: string;
  price_total?: number | null;
} & {
  created: boolean;
  idempotent_replay: boolean;
  fetch_degraded?: boolean;
};

type FetchBooking = (bookingId: string) => Promise<{
  data: (Record<string, unknown> & { id: string; price_total?: number | null }) | null;
  error: unknown | null;
}>;

export async function completeCreateBookingResult(
  payload: CreateBookingRpcPayload,
  fetchBooking: FetchBooking,
  options: { retryDelayMs?: number } = {},
): Promise<CompletedCreateBookingResult> {
  const retryDelayMs = options.retryDelayMs ?? 250;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await fetchBooking(payload.booking_id);
    if (!error && data) {
      return {
        ...data,
        created: payload.created,
        idempotent_replay: payload.idempotent_replay,
      };
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  console.error("[create_booking] post-create fetch failed", { bookingId: payload.booking_id });

  return {
    id: payload.booking_id,
    created: payload.created,
    idempotent_replay: payload.idempotent_replay,
    fetch_degraded: true,
  } as CompletedCreateBookingResult;
}

// Pure payment planning from src/lib/booking/post-create-payment.ts (browser sessionStorage omitted).
export type PaymentMethodType = "cash" | "manual_transfer" | "online";

export type PendingPaymentSelection = {
  paymentMethodId: string;
  methodType: PaymentMethodType;
};

export type PostCreatePaymentPlan =
  | {
      action: "create_now";
      paymentMethodId: string;
      methodType: PaymentMethodType;
    }
  | {
      action: "defer";
      bookingId: string;
      paymentMethodId: string;
      methodType: PaymentMethodType;
    };

type BookingPaymentContext = {
  id: string;
  fetch_degraded?: boolean;
  price_total?: number | null;
};

type SelectedPaymentMethod = {
  id: string;
  method_type: PaymentMethodType;
};

export function planPostCreatePayment(
  booking: BookingPaymentContext,
  selectedMethod: SelectedPaymentMethod,
): PostCreatePaymentPlan {
  if (booking.fetch_degraded) {
    return {
      action: "defer",
      bookingId: booking.id,
      paymentMethodId: selectedMethod.id,
      methodType: selectedMethod.method_type,
    };
  }

  return {
    action: "create_now",
    paymentMethodId: selectedMethod.id,
    methodType: selectedMethod.method_type,
  };
}

export function isPaymentEligibleBookingStatus(status: string | undefined): boolean {
  return status === "pending" || status === "confirmed";
}
