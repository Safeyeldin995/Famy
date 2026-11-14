/**
 * One plain-language glossary for money in Famy (admin and provider).
 * UI must never show raw database codes such as `paid`, `debit` or
 * `cash_collected_platform_share`; every code maps to a short sentence here.
 */
import type { SettlementTranslate } from "./settlementPresentation";

export type MoneyAudience = "admin" | "provider";

type SettlementLike = { direction: string; status: string; amount: number };

function settlementKey(s: SettlementLike): string {
  const status = String(s.status ?? "").toLowerCase();
  if (status === "cancelled") return "cancelled";
  if (Number(s.amount) === 0) return "nothingDue";
  const famyPays = s.direction === "famy_pays_provider";
  const done = status === "paid" || status === "received" || status === "settled";
  if (famyPays) return done ? "famyPaysDone" : "famyPaysPending";
  return done ? "providerPaysDone" : "providerPaysPending";
}

/** One sentence that says who pays whom and whether it already happened. */
export function settlementStateLabel(
  s: SettlementLike,
  audience: MoneyAudience,
  t: SettlementTranslate,
): string {
  const ns = audience === "admin" ? "money.settlementState" : "money.proSettlementState";
  return t(`${ns}.${settlementKey(s)}`);
}

export type MoneyTone = "pending" | "done" | "muted";

export function settlementTone(s: SettlementLike): MoneyTone {
  const key = settlementKey(s);
  if (key === "famyPaysPending" || key === "providerPaysPending") return "pending";
  if (key === "famyPaysDone" || key === "providerPaysDone") return "done";
  return "muted";
}

export function isSettlementOpen(s: { status: string }): boolean {
  return String(s.status ?? "").toLowerCase() === "pending";
}

const LEDGER_KINDS = new Set([
  "cash_collected_platform_share",
  "online_provider_share",
  "payout_sent",
  "debt_payment_received",
  "adjustment",
]);

/** What a single account movement means, in words. */
export function ledgerKindLabel(kind: string, t: SettlementTranslate): string {
  return LEDGER_KINDS.has(kind) ? t(`money.ledgerKind.${kind}`) : t("money.ledgerKind.other");
}

/** Signed amount from the provider's point of view: + adds to what Famy owes them. */
export function ledgerSignedAmount(direction: string, amount: number): number {
  return direction === "credit" ? Math.abs(amount) : -Math.abs(amount);
}

/** Balance as a sentence. Positive net = Famy owes the provider. */
export function balanceSentence(
  net: number,
  audience: MoneyAudience,
  t: SettlementTranslate,
  formatAmount: (n: number) => string,
): string {
  const ns = audience === "admin" ? "money.balance" : "money.proBalance";
  if (Math.abs(net) < 0.005) return t(`${ns}.even`);
  const amount = formatAmount(Math.abs(net));
  return net > 0 ? t(`${ns}.famyOwes`, { amount }) : t(`${ns}.providerOwes`, { amount });
}

const PAYMENT_STATUSES = new Set([
  "pending",
  "pending_review",
  "authorized",
  "captured",
  "rejected",
  "failed",
  "refunded",
  "partially_refunded",
]);

export function paymentStatusLabel(status: string, t: SettlementTranslate): string {
  const key = String(status ?? "").toLowerCase();
  return PAYMENT_STATUSES.has(key) ? t(`money.paymentStatus.${key}`) : t("money.unknown");
}
