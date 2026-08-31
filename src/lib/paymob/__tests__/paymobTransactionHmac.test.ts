import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildPaymobTransactionHmacPayload,
  PAYMOB_TRANSACTION_HMAC_FIELD_ORDER,
} from "../paymobTransactionHmac";
import {
  computePaymobTransactionHmacHex,
  verifyPaymobTransactionHmac,
} from "../paymobHmac.server";

const PAYMOB_DOC_SAMPLE = {
  amount_cents: "100000",
  created_at: "2020-02-02T13:52:05.494",
  currency: "EGP",
  error_occured: false,
  has_parent_transaction: false,
  id: 894447,
  integration_id: 123456,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 987654 },
  owner: 123456,
  pending: false,
  source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
  success: true,
} as const;

describe("PAYMOB_TRANSACTION_HMAC_FIELD_ORDER", () => {
  it("matches Paymob docs field order exactly", () => {
    expect(PAYMOB_TRANSACTION_HMAC_FIELD_ORDER).toEqual([
      "amount_cents",
      "created_at",
      "currency",
      "error_occured",
      "has_parent_transaction",
      "id",
      "integration_id",
      "is_3d_secure",
      "is_auth",
      "is_capture",
      "is_refunded",
      "is_standalone_payment",
      "is_voided",
      "order.id",
      "owner",
      "pending",
      "source_data.pan",
      "source_data.sub_type",
      "source_data.type",
      "success",
    ]);
  });
});

describe("buildPaymobTransactionHmacPayload", () => {
  it("concatenates the 20 fields with no separator", () => {
    expect(buildPaymobTransactionHmacPayload(PAYMOB_DOC_SAMPLE)).toBe(
      "1000002020-02-02T13:52:05.494EGPfalsefalse894447123456truefalsefalsefalsetruefalse987654123456false2346MasterCardcardtrue",
    );
  });

  it("verifies HMAC-SHA512 lowercase hex with the Paymob sample payload", () => {
    const secret = "test-hmac-secret";
    const expected = createHmac("sha512", secret)
      .update(buildPaymobTransactionHmacPayload(PAYMOB_DOC_SAMPLE))
      .digest("hex");
    expect(computePaymobTransactionHmacHex(PAYMOB_DOC_SAMPLE, secret)).toBe(expected);
    expect(verifyPaymobTransactionHmac(PAYMOB_DOC_SAMPLE, expected, secret)).toBe(true);
    expect(verifyPaymobTransactionHmac(PAYMOB_DOC_SAMPLE, "deadbeef", secret)).toBe(false);
  });
});
