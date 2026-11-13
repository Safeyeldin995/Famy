/** Minimal i18n translator (root + mobile `i18next` stay structurally compatible). */
export type SettlementTranslate = (key: string, opts?: Record<string, unknown>) => string;

/** Provider- and admin-facing settlement batch status (no raw DB codes in UI). */
export function settlementStatusLabel(status: string, t: SettlementTranslate): string {
  const key = String(status ?? "").toLowerCase();
  if (key === "pending") return t("pro.settlement.statusPending");
  if (key === "settled") return t("pro.settlement.statusSettled");
  if (key === "cancelled") return t("pro.settlement.statusCancelled");
  return status;
}

export function settlementPeriodShort(periodStart: string, periodEnd: string, locale: string): string {
  const loc = locale.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-US";
  const fmt = new Intl.DateTimeFormat(loc, {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Cairo",
    numberingSystem: "latn",
  });
  return `${fmt.format(new Date(periodStart))} – ${fmt.format(new Date(periodEnd))}`;
}

/** True when cash debt is high but booking intake is not blocked yet. */
export function providerCashDebtNearLimit(
  net: number,
  limit: number,
  warnPercent: number,
): boolean {
  if (net >= 0 || limit <= 0) return false;
  const debt = Math.abs(net);
  const threshold = (limit * warnPercent) / 100;
  return debt >= threshold && debt < limit;
}
