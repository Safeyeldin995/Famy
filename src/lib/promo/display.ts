import type { FeaturedPromoCode } from "@/lib/db/promo-codes-queries";
import { formatEGP, formatDate, formatNumber } from "@/lib/format";

export function promoDescription(
  offer: Pick<FeaturedPromoCode, "description_en" | "description_ar">,
  lang: string,
) {
  if (lang === "ar") return offer.description_ar || offer.description_en;
  return offer.description_en || offer.description_ar;
}

export function promoDiscountLabel(
  offer: Pick<FeaturedPromoCode, "discount_type" | "discount_value">,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  if (offer.discount_type === "percentage") {
    return t("promoCodes.discountPercent", { value: formatNumber(offer.discount_value) });
  }
  return t("promoCodes.discountFixed", { amount: formatEGP(offer.discount_value) });
}

export function promoExpiryLabel(
  expiresAt: string | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  if (!expiresAt) return null;
  return t("promoCodes.expires", { date: formatDate(new Date(expiresAt), { day: "numeric", month: "short", year: "numeric" }) });
}
