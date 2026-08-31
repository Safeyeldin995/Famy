import { createHmac, timingSafeEqual } from "node:crypto";
import {
  buildPaymobTransactionHmacPayload,
  type PaymobTransactionHmacSource,
} from "./paymobTransactionHmac";

export function computePaymobTransactionHmacHex(
  obj: PaymobTransactionHmacSource,
  hmacSecret: string,
): string {
  const payload = buildPaymobTransactionHmacPayload(obj);
  return createHmac("sha512", hmacSecret).update(payload).digest("hex");
}

export function verifyPaymobTransactionHmac(
  obj: PaymobTransactionHmacSource,
  receivedHmac: string | null | undefined,
  hmacSecret: string,
): boolean {
  if (!receivedHmac) return false;
  const computed = computePaymobTransactionHmacHex(obj, hmacSecret);
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(receivedHmac, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
