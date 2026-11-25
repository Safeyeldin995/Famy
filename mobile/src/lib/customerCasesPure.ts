/**
 * Pure rules for the customer "problem with this booking" sheet, mirroring the
 * database RPCs (report_no_show, open_booking_dispute, create_support_ticket).
 * The server remains the authority; these only decide which options to show.
 */

/** report_no_show accepts only these statuses (provider set off or arrived). */
export const NO_SHOW_ELIGIBLE_STATUSES = ["on_the_way", "arrived"] as const;

/** open_booking_dispute accepts only these statuses. */
export const DISPUTE_ELIGIBLE_STATUSES = [
  "on_the_way",
  "arrived",
  "arrival_confirmed",
  "in_progress",
  "completion_requested",
] as const;

const ACTIVE_CASE = new Set(["open", "info_requested"]);
const ACTIVE_TICKET = new Set(["open", "pending"]);

export type CaseLike = { status: string; category?: string | null };

export function hasActiveCase(rows: CaseLike[] | undefined | null): boolean {
  return (rows ?? []).some((r) => ACTIVE_CASE.has(r.status));
}

/**
 * True when an open/pending ticket exists. With a category, only tickets of that
 * category count (create_support_ticket rejects a second open ticket for the same
 * booking, user and category).
 */
export function hasActiveTicket(
  rows: CaseLike[] | undefined | null,
  category?: string,
): boolean {
  return (rows ?? []).some(
    (r) => ACTIVE_TICKET.has(r.status) && (category === undefined || r.category === category),
  );
}

/** Category the customer app uses for booking support tickets. */
export const BOOKING_SUPPORT_CATEGORY = "booking_issue";

export type ProblemOptions = {
  noShow: boolean;
  dispute: boolean;
  support: boolean;
};

/**
 * Which problem options a customer may use on an in-person booking right now.
 * Online lessons have their own in-call issue report, so they are excluded.
 */
export function customerProblemOptions(input: {
  bookingStatus: string | null | undefined;
  serviceMode: string | null | undefined;
  noShowReports?: CaseLike[] | null;
  disputes?: CaseLike[] | null;
  tickets?: CaseLike[] | null;
}): ProblemOptions {
  const status = input.bookingStatus ?? "";
  const inPerson = (input.serviceMode ?? "in_person") !== "online";
  return {
    noShow:
      inPerson &&
      (NO_SHOW_ELIGIBLE_STATUSES as readonly string[]).includes(status) &&
      !hasActiveCase(input.noShowReports),
    dispute:
      inPerson &&
      (DISPUTE_ELIGIBLE_STATUSES as readonly string[]).includes(status) &&
      !hasActiveCase(input.disputes),
    // A ticket can be opened on any booking the customer is part of, but only one
    // open booking_issue ticket at a time (the RPC rejects a second one).
    support: !hasActiveTicket(input.tickets, BOOKING_SUPPORT_CATEGORY),
  };
}

/** create_support_ticket and open_booking_dispute need at least 10 characters. */
export const CASE_MIN_DESCRIPTION = 10;

export function isCaseDescriptionValid(text: string): boolean {
  return text.trim().length >= CASE_MIN_DESCRIPTION;
}

/**
 * How a card checkout is split: the server (customer_apply_wallet_at_checkout,
 * called by the Paymob checkout route) always spends the available wallet
 * balance first and charges the card only for the rest.
 */
export function walletCheckoutSplit(
  total: number | null | undefined,
  available: number | null | undefined,
): { walletPart: number; cardPart: number; walletOnly: boolean } {
  const t = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0;
  const a = Number.isFinite(Number(available)) ? Math.max(0, Number(available)) : 0;
  const walletPart = Math.round(Math.min(a, t) * 100) / 100;
  const cardPart = Math.round(Math.max(0, t - walletPart) * 100) / 100;
  return { walletPart, cardPart, walletOnly: t > 0 && cardPart <= 0.01 };
}

export type WalletSplitView =
  | { kind: "none" }
  | { kind: "checking" }
  | { kind: "split"; walletPart: number; cardPart: number; walletOnly: boolean };

/**
 * What the payment card may promise about the wallet. The balance must be fresh:
 * while it is (re)loading or failed to load, show a neutral line and never a split,
 * because the server spends whatever balance is left at checkout time.
 */
export function walletSplitView(input: {
  eligible: boolean;
  total: number | null | undefined;
  available: number | null | undefined;
  balanceFetching: boolean;
  balanceOk: boolean;
}): WalletSplitView {
  if (!input.eligible) return { kind: "none" };
  if (input.balanceFetching || !input.balanceOk) return { kind: "checking" };
  const split = walletCheckoutSplit(input.total, input.available);
  if (split.walletPart <= 0) return { kind: "none" };
  return { kind: "split", ...split };
}

export type CancellationPolicyRow = {
  fee_mode: "fixed" | "percent";
  fee_value: number;
  free_cancel_hours: number;
};

/** Normalises a cancellation_policy_for() row (same bounds as the database). */
export function normalizeCancellationPolicy(
  row: { fee_mode?: unknown; fee_value?: unknown; free_cancel_hours?: unknown } | null | undefined,
): CancellationPolicyRow | null {
  if (!row) return null;
  const mode = row.fee_mode === "percent" ? "percent" : "fixed";
  const fee = Number(row.fee_value);
  const hours = Number(row.free_cancel_hours);
  return {
    fee_mode: mode,
    fee_value: Number.isFinite(fee) && fee > 0 ? (mode === "percent" ? Math.min(fee, 100) : fee) : 0,
    free_cancel_hours: Number.isFinite(hours) && hours >= 0 ? hours : 2,
  };
}

/** i18n key + params for the one-line policy shown before the customer confirms. */
export function cancellationPolicyLine(
  policy: CancellationPolicyRow | null,
  formatMoney: (amount: number) => string,
): { key: string; params: Record<string, string | number> } | null {
  if (!policy) return null;
  if (policy.fee_value <= 0) return { key: "bookFlow.policyFree", params: {} };
  const fee =
    policy.fee_mode === "percent" ? `${policy.fee_value}%` : formatMoney(policy.fee_value);
  if (policy.free_cancel_hours <= 0) return { key: "bookFlow.policyFeeAlways", params: { fee } };
  return {
    key: "bookFlow.policyFreeUntil",
    params: { hours: policy.free_cancel_hours, fee },
  };
}
