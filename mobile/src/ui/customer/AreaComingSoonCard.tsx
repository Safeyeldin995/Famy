import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { MapPinned } from "lucide-react-native";
import { useRequestArea } from "@/lib/bookingQueries";
import { Button } from "../Button";
import { Text } from "../Text";
import { colors, radius } from "../theme";

/** Shown when the address pin is outside every service zone. */
export function AreaComingSoonCard({ pin }: { pin: { lat: number; lng: number } }) {
  const { t } = useTranslation();
  const request = useRequestArea();
  const limited = /area_request_rate_limited/.test(
    request.error && typeof request.error === "object" && "message" in request.error
      ? String(request.error.message)
      : "",
  );
  return (
    <View
      style={{
        gap: 10,
        padding: 16,
        borderRadius: radius.lg,
        backgroundColor: colors.brandTint,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <MapPinned size={20} color={colors.brand} />
        <Text weight="heavy">{t("addresses.comingSoonTitle")}</Text>
      </View>
      <Text size="sm" tone="muted">
        {t("addresses.comingSoonBody")}
      </Text>
      {request.isSuccess || limited ? (
        <Text size="sm" weight="bold" tone="brand">
          {t("addresses.comingSoonThanks")}
        </Text>
      ) : (
        <Button
          label={t("addresses.comingSoonCta")}
          loading={request.isPending}
          onPress={() => request.mutate(pin)}
        />
      )}
      {request.isError && !limited ? (
        <Text size="sm" tone="danger">
          {t("common.somethingWentWrong")}
        </Text>
      ) : null}
    </View>
  );
}
