import { formatNumber } from "@shared/format/egp";
import { uiListSeparator } from "@shared/format/uiJoin";

/** One rating line everywhere: avg then localized review count (stable in RTL). */
export function providerRatingSummary(
  ratingAvg: number,
  reviewCountLabel: string,
  language: string,
) {
  const avg = formatNumber(Number(ratingAvg.toFixed(1)), language);
  return `${avg}${uiListSeparator(language)}${reviewCountLabel}`;
}
