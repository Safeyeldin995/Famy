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

const PENDING_PAYMENT_KEY_PREFIX = "famy:pendingPayment:";

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

function canUseSessionStorage(): boolean {
  return typeof sessionStorage !== "undefined";
}

export function stashPendingPayment(bookingId: string, selection: PendingPaymentSelection): void {
  if (!canUseSessionStorage()) return;
  sessionStorage.setItem(`${PENDING_PAYMENT_KEY_PREFIX}${bookingId}`, JSON.stringify(selection));
}

export function peekPendingPayment(bookingId: string): PendingPaymentSelection | null {
  if (!canUseSessionStorage()) return null;
  const raw = sessionStorage.getItem(`${PENDING_PAYMENT_KEY_PREFIX}${bookingId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingPaymentSelection;
  } catch {
    return null;
  }
}

export function clearPendingPayment(bookingId: string): void {
  if (!canUseSessionStorage()) return;
  sessionStorage.removeItem(`${PENDING_PAYMENT_KEY_PREFIX}${bookingId}`);
}

export function isPaymentEligibleBookingStatus(status: string | undefined): boolean {
  return status === "pending" || status === "confirmed";
}
