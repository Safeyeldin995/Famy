import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Star } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { STAR_RATINGS, isStarFilled, type StarRatingValue } from "@shared/ui/starRating";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { customerStyle } from "./Primitives";
import { hapticLightImpact } from "@/ui/haptics";

type Props = {
  bookingId: string;
  providerName: string;
  testID?: string;
};

export function RatingPromptCard({ bookingId, providerName, testID }: Props) {
  const { t } = useTranslation();

  const openReview = (rating?: StarRatingValue) => {
    hapticLightImpact();
    router.push({
      pathname: "/booking/[id]",
      params: {
        id: bookingId,
        ...(rating ? { review: "1", presetRating: String(rating) } : { review: "1" }),
      },
    });
  };

  return (
    <View
      testID={testID}
      style={[
        customerStyle.card,
        {
          marginHorizontal: space.xl,
          marginTop: space.lg,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          gap: space.md,
        },
      ]}
    >
      <Text weight="heavy">{t("customerHome.ratePrompt", { provider: providerName })}</Text>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: space.xs }}>
        {STAR_RATINGS.map((star) => (
          <Pressable
            key={star}
            accessibilityRole="button"
            accessibilityLabel={t("mobileBooking.starA11y", { n: star })}
            onPress={() => openReview(star)}
            style={{
              minWidth: 44,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Star
              size={32}
              color={isStarFilled(star, 0) ? colors.border : colors.ratingGold}
              fill="transparent"
            />
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("customerHome.openRateForm")}
        onPress={() => openReview()}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text size="sm" tone="brand" weight="bold" style={{ textAlign: "center" }}>
          {t("customerHome.openRateForm")}
        </Text>
      </Pressable>
    </View>
  );
}