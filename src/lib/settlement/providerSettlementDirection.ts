/** Provider-facing settlement batch direction (UI copy). */
export function providerSettlementDirectionLabel(
  direction: string,
  t: (key: string) => string,
): string {
  return direction === "famy_pays_provider"
    ? t("pro.settlement.directionFamyPays")
    : t("pro.settlement.directionYouPay");
}

/** Admin-facing settlement batch direction (who pays whom). */
export function adminSettlementDirectionLabel(
  direction: string,
  t: (key: string) => string,
): string {
  return direction === "famy_pays_provider"
    ? t("admin.settlement.directionFamyPays")
    : t("admin.settlement.directionProviderPays");
}
