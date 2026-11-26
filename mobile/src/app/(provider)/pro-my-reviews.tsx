import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react-native";
import { useMyProvider } from "@/lib/provider/queries";
import { useProviderMyReviews } from "@/lib/provider/journeyQueries";
import { Page, QueryState } from "@/ui/Page";
import { ProviderHeader } from "@/ui/provider/ProviderHeader";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { customerNumber } from "@/lib/customerFormat";

function ratingBreakdown(reviews: { rating: number }[]) {
  const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const row of reviews) {
    const r = Math.round(row.rating) as 1 | 2 | 3 | 4 | 5;
    if (r >= 1 && r <= 5) counts[r] += 1;
  }
  return counts;
}

export default function ProviderMyReviews() {
  const { t, i18n } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as { id?: string } | null | undefined;
  const reviewsQ = useProviderMyReviews(provider?.id);
  const reviews = reviewsQ.data ?? [];
  const breakdown = ratingBreakdown(reviews);

  return (
    <Page
      title={t("proReviews.title")}
      header={<ProviderHeader title={t("proReviews.title")} />}
      queries={[p, reviewsQ]}
    >
      <View style={{ gap: space.md }}>
        <Text weight="heavy">{t("proReviews.breakdown")}</Text>
        {([5, 4, 3, 2, 1] as const).map((star) => (
          <View key={star} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Star size={16} color={colors.warning} fill={colors.warning} />
            <Text weight="bold" style={{ width: 28, writingDirection: "ltr" }}>
              {customerNumber(star, i18n.language)}
            </Text>
            <View
              style={{
                flex: 1,
                height: 8,
                borderRadius: radius.pill,
                backgroundColor: colors.surface2,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: reviews.length ? `${(breakdown[star] / reviews.length) * 100}%` : "0%",
                  height: "100%",
                  backgroundColor: colors.brand,
                }}
              />
            </View>
            <Text tone="muted" size="sm" style={{ width: 32, textAlign: "end", writingDirection: "ltr" }}>
              {customerNumber(breakdown[star], i18n.language)}
            </Text>
          </View>
        ))}
      </View>
      <QueryState query={reviewsQ} empty={!reviews.length} emptyKey="proReviews.empty">
        <View style={{ gap: space.md, marginTop: space.lg }}>
          {reviews.map((row) => (
            <View
              key={row.id}
              style={{
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.border,
                padding: space.md,
                gap: space.xs,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                <Star size={14} color={colors.warning} fill={colors.warning} />
                <Text weight="bold" style={{ writingDirection: "ltr" }}>
                  {customerNumber(row.rating, i18n.language)}
                </Text>
                <Text tone="muted" size="sm" style={{ flex: 1 }} numberOfLines={1}>
                  {row.customer?.full_name ?? t("pro.common.customer")}
                </Text>
              </View>
              {row.comment ? <Text size="sm">{row.comment}</Text> : null}
            </View>
          ))}
        </View>
      </QueryState>
    </Page>
  );
}