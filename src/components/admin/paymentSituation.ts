/**
 * Plain-language state of a payment for the admin payments page.
 *
 * A raw payment status alone is misleading: a cash payment on a cancelled booking
 * still reads "pending" in the database, but nothing is owed. This combines the
 * payment, its method, the booking status and the provider ledger into one
 * situation with a short label, an explanation and the one action (if any).
 */

export type PaymentSituation =
  | "review" // transfer receipt waiting for admin review
  | "awaitingProof" // transfer chosen, no receipt yet
  | "awaitingCard" // online card payment not completed
  | "cashAtVisit" // cash, booking still active: provider collects at the visit
  | "cashRecorded" // cash, completed, Famy's share is on the provider's account
  | "cashUnconfirmed" // cash, completed before the ledger, admin must confirm
  | "noPaymentDue" // booking cancelled / no-show before any payment
  | "refundDue" // money received but the booking was cancelled / no-show: send it back
  | "paid"
  | "rejected"
  | "failed"
  | "refunded"
  | "other";

export type PaymentSituationInput = {
  status?: string | null;
  payment_method_type?: string | null;
  method?: string | null;
  proof_path?: string | null;
  booking?: { status?: string | null } | null;
};

const CLOSED_WITHOUT_SERVICE = new Set(["cancelled", "no_show"]);

function methodType(p: PaymentSituationInput) {
  if (p.payment_method_type) return p.payment_method_type;
  if (p.method === "instapay") return "manual_transfer";
  if (p.method === "cash") return "cash";
  if (p.method === "paymob" || p.method === "card") return "online";
  return "";
}

/**
 * @param hasCashLedger whether the booking already has Famy's cash share on the
 *   provider ledger (cash_collected_platform_share).
 */
export function paymentSituation(
  p: PaymentSituationInput,
  hasCashLedger = false,
): PaymentSituation {
  const status = p.status ?? "";
  const booking = p.booking?.status ?? "";
  const type = methodType(p);

  const closed = CLOSED_WITHOUT_SERVICE.has(booking);
  // Money already with Famy on a booking that will not happen: it goes back to the customer.
  if (status === "captured") return closed && type !== "cash" ? "refundDue" : "paid";
  if (closed && status === "pending_review" && type === "manual_transfer" && p.proof_path)
    return "refundDue";
  if (status === "refunded" || status === "partially_refunded") return "refunded";
  if (status === "rejected") return "rejected";
  if (status === "failed") return "failed";
  if (status === "pending_review" && type === "manual_transfer" && !closed) return "review";

  if (status === "pending" || status === "pending_review" || status === "authorized") {
    if (CLOSED_WITHOUT_SERVICE.has(booking)) return "noPaymentDue";
    if (type === "cash") {
      if (booking !== "completed") return "cashAtVisit";
      return hasCashLedger ? "cashRecorded" : "cashUnconfirmed";
    }
    if (type === "manual_transfer") return p.proof_path ? "review" : "awaitingProof";
    if (type === "online") return "awaitingCard";
  }
  return "other";
}

export type SituationTone = "action" | "waiting" | "done" | "closed" | "problem";

export function situationTone(s: PaymentSituation): SituationTone {
  switch (s) {
    case "review":
    case "cashUnconfirmed":
    case "refundDue":
      return "action";
    case "awaitingProof":
    case "awaitingCard":
    case "cashAtVisit":
      return "waiting";
    case "paid":
    case "cashRecorded":
    case "refunded":
      return "done";
    case "noPaymentDue":
      return "closed";
    case "rejected":
    case "failed":
      return "problem";
    default:
      return "waiting";
  }
}

/** Needs an admin decision: sorted first and counted in the header. */
export function needsAdminAction(s: PaymentSituation) {
  return situationTone(s) === "action";
}
