import { describe, expect, it, vi } from "vitest";
import {
  clearPendingPayment,
  isPaymentEligibleBookingStatus,
  peekPendingPayment,
  planPostCreatePayment,
  stashPendingPayment,
} from "@/lib/booking/post-create-payment";

describe("planPostCreatePayment", () => {
  const selectedMethod = {
    id: "method-1",
    method_type: "cash" as const,
  };

  it("defers payment when post-create booking fetch is degraded", () => {
    const plan = planPostCreatePayment(
      { id: "booking-1", fetch_degraded: true },
      selectedMethod,
    );
    expect(plan).toEqual({
      action: "defer",
      bookingId: "booking-1",
      paymentMethodId: "method-1",
      methodType: "cash",
    });
  });

  it("creates payment immediately when authoritative booking data is available", () => {
    const plan = planPostCreatePayment(
      { id: "booking-1", price_total: 253 },
      selectedMethod,
    );
    expect(plan).toEqual({
      action: "create_now",
      paymentMethodId: "method-1",
      methodType: "cash",
    });
  });
});

describe("pending payment session storage", () => {
  it("stores and clears pending payment selection by booking id", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    });

    clearPendingPayment("booking-1");
    stashPendingPayment("booking-1", {
      paymentMethodId: "method-1",
      methodType: "manual_transfer",
    });
    expect(peekPendingPayment("booking-1")).toEqual({
      paymentMethodId: "method-1",
      methodType: "manual_transfer",
    });
    clearPendingPayment("booking-1");
    expect(peekPendingPayment("booking-1")).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe("isPaymentEligibleBookingStatus", () => {
  it("allows payment only for pending and confirmed bookings", () => {
    expect(isPaymentEligibleBookingStatus("pending")).toBe(true);
    expect(isPaymentEligibleBookingStatus("confirmed")).toBe(true);
    expect(isPaymentEligibleBookingStatus("completed")).toBe(false);
    expect(isPaymentEligibleBookingStatus(undefined)).toBe(false);
  });
});
