import { moneyHeld } from "@/lib/payments/refundOwed";

export type OnlineWebPayMode = "hidden" | "manual_transfer" | "online";

type PaymentRowLike = {
  status?: string | null;
  payment_method_type?: string | null;
  proof_path?: string | null;
} | null | undefined;

/**
 * Which payment UI the online lesson page shows for the booking's existing payment row.
 * - hidden: money is already held (captured, or a transfer receipt is in review).
 * - manual_transfer: a transfer was started (e.g. in the app). Wallet/Paymob checkout
 *   rejects that row, so reuse the method-aware PaymentBlock (instructions + receipt upload).
 * - online: no row yet, or an online row; run wallet-first + Paymob checkout.
 */
export function onlineWebPayMode(p: PaymentRowLike): OnlineWebPayMode {
  if (
    moneyHeld({
      paymentStatus: p?.status ?? undefined,
      methodType: p?.payment_method_type ?? undefined,
      proofPath: p?.proof_path ?? undefined,
    })
  )
    return "hidden";
  if (p?.payment_method_type === "manual_transfer") return "manual_transfer";
  return "online";
}
