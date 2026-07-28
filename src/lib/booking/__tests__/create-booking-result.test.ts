import { describe, expect, it, vi } from "vitest";
import { completeCreateBookingResult } from "@/lib/booking/create-booking-result";

const rpcPayload = {
  booking_id: "99999999-9999-9999-9999-999999999999",
  created: true,
  idempotent_replay: false,
};

const bookingRow = {
  id: rpcPayload.booking_id,
  customer_id: "customer",
  provider_id: "provider",
  service_id: "service",
  address_id: "address",
  start_at: "2026-08-01T10:00:00.000Z",
  end_at: "2026-08-01T12:00:00.000Z",
  status: "pending",
  notes: null,
  price_subtotal: 200,
  price_total: 253,
  price_discount: 0,
  promo_code: null,
  promo_code_id: null,
  promo_discount_type: null,
  promo_discount_value: null,
  promo_description_en: null,
  promo_description_ar: null,
  family_member_id: null,
  requirement_selections: [],
  zone_id: null,
  cancellation_reason: null,
  idempotency_key: "11111111-1111-1111-1111-111111111111",
  request_fingerprint: "fp",
  created_at: "2026-08-01T09:00:00.000Z",
  updated_at: "2026-08-01T09:00:00.000Z",
};

describe("completeCreateBookingResult", () => {
  it("returns the fetched booking when the follow-up SELECT succeeds", async () => {
    const fetchBooking = vi.fn().mockResolvedValue({ data: bookingRow, error: null });
    const result = await completeCreateBookingResult(rpcPayload, fetchBooking, { retryDelayMs: 0 });
    expect(fetchBooking).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(rpcPayload.booking_id);
    expect(result.price_total).toBe(253);
    expect(result.fetch_degraded).toBeUndefined();
  });

  it("retries once and returns a degraded result when follow-up SELECT keeps failing", async () => {
    const fetchBooking = vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const result = await completeCreateBookingResult(rpcPayload, fetchBooking, { retryDelayMs: 0 });
    expect(fetchBooking).toHaveBeenCalledTimes(2);
    expect(result.id).toBe(rpcPayload.booking_id);
    expect(result.fetch_degraded).toBe(true);
  });
});
