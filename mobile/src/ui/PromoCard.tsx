import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import type { FeaturedPromoCode } from "@/lib/queries";
import { dateTime, money } from "@/lib/presentation";
import { Text } from "./Text";
import { Button } from "./Button";
import { ActionError, ui } from "./Page";

export function PromoCard({ offer }: { offer: FeaturedPromoCode }) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <View style={ui.card}>
      <Text size="xl" weight="heavy" style={ui.ltr}>
        {offer.code}
      </Text>
      <Text weight="bold" style={ui.ltr}>
        {offer.discount_type === "percentage"
          ? t("promoCodes.discountPercent", { value: offer.discount_value })
          : t("promoCodes.discountFixed", { amount: money(offer.discount_value, i18n.language) })}
      </Text>
      <Text>
        {(i18n.language === "ar" ? offer.description_ar : offer.description_en) ||
          offer.description_en}
      </Text>
      {offer.minimum_booking_amount > 0 && (
        <Text tone="muted" style={ui.ltr}>
          {t("promoCodes.minSpend", { amount: money(offer.minimum_booking_amount, i18n.language) })}
        </Text>
      )}
      {offer.expires_at && (
        <Text tone="muted">
          {t("promoCodes.expires", { date: dateTime(offer.expires_at, i18n.language) })}
        </Text>
      )}
      <Button
        variant="secondary"
        label={t(copied ? "mobile.copied" : "mobile.copyCode")}
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
      <ActionError error={error} />
    </View>
  );
}
