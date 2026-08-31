/**
 * Paymob Transaction Processed callback HMAC (SHA-512, lowercase hex).
 * Field order from Paymob docs:
 * https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac
 */

export type PaymobTransactionHmacSource = {
  amount_cents: unknown;
  created_at: unknown;
  currency: unknown;
  error_occured: unknown;
  has_parent_transaction: unknown;
  id: unknown;
  integration_id: unknown;
  is_3d_secure: unknown;
  is_auth: unknown;
  is_capture: unknown;
  is_refunded: unknown;
  is_standalone_payment: unknown;
  is_voided: unknown;
  order?: { id?: unknown } | null;
  owner: unknown;
  pending: unknown;
  source_data?: { pan?: unknown; sub_type?: unknown; type?: unknown } | null;
  success: unknown;
};

export const PAYMOB_TRANSACTION_HMAC_FIELD_ORDER = [
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
] as const;

function fieldValue(obj: PaymobTransactionHmacSource, key: (typeof PAYMOB_TRANSACTION_HMAC_FIELD_ORDER)[number]): unknown {
  switch (key) {
    case "order.id":
      return obj.order?.id;
    case "source_data.pan":
      return obj.source_data?.pan;
    case "source_data.sub_type":
      return obj.source_data?.sub_type;
    case "source_data.type":
      return obj.source_data?.type;
    default:
      return obj[key as keyof PaymobTransactionHmacSource];
  }
}

/** Concatenate the 20 Paymob transaction HMAC fields with no separator. */
export function buildPaymobTransactionHmacPayload(obj: PaymobTransactionHmacSource): string {
  return PAYMOB_TRANSACTION_HMAC_FIELD_ORDER
    .map((key) => {
      const value = fieldValue(obj, key);
      if (value === null || value === undefined) return "";
      return String(value);
    })
    .join("");
}
