import { describe, expect, it } from "vitest";
import { PaymobIntentionIndeterminateError } from "@/lib/paymob/paymobApi.server";
import {
  mapPaymobCheckoutApiFailure,
  mobileOtpSendFailureStatus,
} from "@/lib/mobile/mobileApiStatus.server";

describe("mobileOtpSendFailureStatus", () => {
  it("maps rate limits to 429", () => {
    expect(mobileOtpSendFailureStatus("rate_limited_phone")).toBe(429);
    expect(mobileOtpSendFailureStatus("rate_limited_ip")).toBe(429);
  });

  it("maps delivery outages to 503", () => {
    expect(mobileOtpSendFailureStatus("delivery_failed")).toBe(503);
    expect(mobileOtpSendFailureStatus("temporarily_unavailable")).toBe(503);
  });

  it("maps configuration mismatches to 400", () => {
    expect(mobileOtpSendFailureStatus("flow_mismatch")).toBe(409);
    expect(mobileOtpSendFailureStatus("provider_mismatch")).toBe(400);
  });
});

describe("mapPaymobCheckoutApiFailure", () => {
  it("maps ownership and resource errors without 500", () => {
    expect(mapPaymobCheckoutApiFailure(new Error("You cannot pay for this booking."))).toEqual({
      status: 403,
      error: "forbidden",
    });
    expect(mapPaymobCheckoutApiFailure(new Error("Booking not found."))).toEqual({
      status: 404,
      error: "not_found",
    });
    expect(
      mapPaymobCheckoutApiFailure(
        new Error("Paymob checkout is already in progress for this payment."),
      ),
    ).toEqual({
      status: 409,
      error: "checkout_in_progress",
    });
  });

  it("maps indeterminate Paymob errors to checkout_unavailable", () => {
    expect(
      mapPaymobCheckoutApiFailure(
        new PaymobIntentionIndeterminateError("Could not reach Paymob to start checkout."),
      ),
    ).toEqual({
      status: 503,
      error: "checkout_unavailable",
    });
  });
});

describe("mapPaymobCheckoutApiFailure for lookup outages", () => {
  it("keeps database lookup failures as a retryable 503", () => {
    expect(mapPaymobCheckoutApiFailure(new Error("Could not load checkout data."))).toEqual({
      status: 503,
      error: "checkout_unavailable",
    });
  });
});
