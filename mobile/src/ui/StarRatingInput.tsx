import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react-native";
import {
  isStarFilled,
  ratingLabelKey,
  STAR_RATINGS,
  type StarRatingValue,
  starRowDirection,
} from "@shared/ui/starRating";
import { colors, space } from "./theme";
import { Text } from "./Text";

export function StarRatingInput({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label?: string;
  value: number;
  onChange?: (rating: StarRatingValue) => void;
  readOnly?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const rowDirection = starRowDirection(i18n.language);

  return (
    <View style={{ gap: space.sm }}>
      {label ? <Text weight="bold">{label}</Text> : null}
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={
          value > 0
            ? t("mobileBooking.starSelectedGroup", { n: value })
            : (label ?? t("mobileBooking.rating"))
        }
      >
        <View
          style={{
            flexDirection: rowDirection,
            justifyContent: "center",
            gap: space.xs,
          }}
        >
          {STAR_RATINGS.map((star) => {
            const filled = isStarFilled(star, value);
            return (
              <Pressable
                key={star}
                disabled={readOnly || !onChange}
                accessibilityRole="button"
                accessibilityLabel={t("mobileBooking.starA11y", { n: star })}
                accessibilityState={{ selected: filled }}
                onPress={() => onChange?.(star)}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Star
                  size={34}
                  color={filled ? colors.ratingGold : colors.border}
                  fill={filled ? colors.ratingGold : "transparent"}
                />
              </Pressable>
            );
          })}
        </View>
        {value > 0 ? (
          <Text style={{ textAlign: "center", marginTop: space.xs }}>
            {t(ratingLabelKey(value as StarRatingValue))}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
