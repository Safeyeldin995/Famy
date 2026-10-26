import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Copy, Tag } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import type { FeaturedPromoCode } from "@/lib/queries";
import { money } from "@/lib/presentation";
import { Text } from "./Text";
import { colors } from "./theme";

/** Native rendering of components/home/HomePromoStrip, using the same copy and actions. */
export function HomePromoStrip({ offer }: { offer: FeaturedPromoCode }) {
  const { t, i18n } = useTranslation();
  const [feedback, setFeedback] = useState<string | null>(null);
  const description =
    i18n.language === "ar"
      ? offer.description_ar || offer.description_en
      : offer.description_en || offer.description_ar;
  return (
    <View style={styles.panel}>
      <View style={styles.badge}>
        <Tag size={12} color="white" />
        <Text size="xs" weight="heavy" tone="inverse">
          {t("home.offers.promoLabel")}
        </Text>
      </View>
      <Text size="xxl" weight="heavy" tone="inverse" style={{ marginTop: 12 }}>
        {offer.discount_type === "percentage"
          ? t("promoCodes.discountPercent", { value: offer.discount_value })
          : t("promoCodes.discountFixed", { amount: money(offer.discount_value, i18n.language) })}
      </Text>
      {description ? (
        <Text size="xs" tone="inverse" numberOfLines={2} style={{ opacity: 0.75, marginTop: 6 }}>
          {description}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("promoCodes.copyCode")}
        style={styles.copy}
        onPress={async () => {
          try {
            if (!(await Clipboard.setStringAsync(offer.code)))
              throw new Error("Clipboard unavailable");
            setFeedback(t("promoCodes.copied", { code: offer.code }));
          } catch {
            setFeedback(t("promoCodes.copyError"));
          }
        }}
      >
        <Text size="xs" weight="heavy" tone="inverse">
          {offer.code}
        </Text>
        <Copy size={14} color="white" />
      </Pressable>
      {feedback ? (
        <Text size="xs" tone="inverse" accessibilityLiveRegion="polite">
          {feedback}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    width: 272,
    flexShrink: 0,
    borderRadius: 28,
    padding: 20,
    backgroundColor: "#1F1419",
    alignItems: "flex-start",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  copy: {
    direction: "ltr",
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 16,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
});
