import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { BadgePercent } from "lucide-react-native";
import { launchCommissionLastDay, launchCommissionPercentLabel } from "@shared/offers/launchOffers";
import { useMyLaunchCommission } from "@/lib/launchOffersQueries";
import { Text } from "../Text";
import { colors, radius, space } from "../theme";

/** «عمولتك أقل لحد {date}» while the new-tutor commission applies. */
export function LaunchCommissionBanner({ enabled = true }: { enabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const q = useMyLaunchCommission(enabled);
  if (!q.data || !q.data.active) return null;
  const date = launchCommissionLastDay(q.data.ends_at, i18n.language);
  const percent = launchCommissionPercentLabel(q.data);
  return (
    <View
      accessible
      accessibilityLabel={t("launchCommission.banner", { date })}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.success,
        backgroundColor: colors.successTint,
      }}
    >
      <BadgePercent size={20} color={colors.success} accessible={false} />
      <View style={{ flexShrink: 1, gap: space.xs }}>
        <Text weight="bold">{t("launchCommission.banner", { date })}</Text>
        {percent ? (
          <Text size="sm" tone="muted">
            {t("launchCommission.bannerRate", { percent })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
