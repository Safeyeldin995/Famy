import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import type { FeaturedPromoCode } from "@/lib/queries";
import { money } from "@/lib/presentation";
import { Copy, Check } from "lucide-react-native";
import { colors } from "./theme";
import { Text } from "./Text";
import { Button } from "./Button";
import { ActionError, ui } from "./Page";

export function PromoCard({ offer }: { offer: FeaturedPromoCode }) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <View
      style={[
        ui.card,
        { padding: 16, borderRadius: 28, backgroundColor: colors.ink, borderColor: colors.ink },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text size="xl" weight="heavy" tone="inverse">
            {offer.discount_type === "percentage"
              ? t("promoCodes.discountPercent", { value: offer.discount_value })
              : t("promoCodes.discountFixed", {
                  amount: money(offer.discount_value, i18n.language),
                })}
          </Text>
          <Text tone="inverse" style={{ opacity: 0.75 }}>
            {(i18n.language === "ar" ? offer.description_ar : offer.description_en) ||
              offer.description_en}
          </Text>
          {offer.expires_at && (
            <Text size="xs" weight="bold" tone="inverse" style={{ opacity: 0.6, marginTop: 4 }}>
              {t("promoCodes.expires", {
                date: new Date(offer.expires_at).toLocaleDateString(
                  i18n.language === "ar" ? "ar-EG-u-nu-latn" : "en-EG",
                  { day: "numeric", month: "short", year: "numeric" },
                ),
              })}
            </Text>
          )}
          {offer.minimum_booking_amount > 0 && (
            <Text size="xs" weight="bold" tone="inverse" style={{ opacity: 0.6 }}>
              {t("promoCodes.minSpend", {
                amount: money(offer.minimum_booking_amount, i18n.language),
              })}
            </Text>
          )}
        </View>
        <Button
          label={copied ? t("mobile.copied") : offer.code}
          accessibilityLabel={t(copied ? "mobile.copied" : "promoCodes.copyCode")}
          icon={copied ? <Check size={14} color="white" /> : <Copy size={14} color="white" />}
          style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 999, direction: "ltr" }}
          onPress={async () => {
            try {
              if (!(await Clipboard.setStringAsync(offer.code)))
                throw new Error("Clipboard unavailable");
              setCopied(true);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        />
      </View>
      <ActionError error={error} />
    </View>
  );
}
