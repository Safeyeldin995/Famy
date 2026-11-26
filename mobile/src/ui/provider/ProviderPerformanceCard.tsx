import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { providerPerformanceTipKey, type ProviderPerformanceStats } from "@shared/provider/performanceStats";
import { customerNumber } from "@/lib/customerFormat";

export function ProviderPerformanceCard({ stats }: { stats: ProviderPerformanceStats }) {
  const { t, i18n } = useTranslation();
  const tip = providerPerformanceTipKey(stats);
  const pct = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value)
      ? "—"
      : `${customerNumber(Math.round(value * 10) / 10, i18n.language)}%`;

  return (
    <View
      style={{
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        padding: space.md,
        gap: space.md,
      }}
    >
      <Text weight="heavy">{t("proPerformance.title")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {(
          [
            ["proPerformance.acceptance", stats.acceptance_rate],
            ["proPerformance.completion", stats.completion_rate],
            ["proPerformance.response", stats.median_response_minutes],
            ["proPerformance.cancellation", stats.provider_cancellation_rate],
          ] as const
        ).map(([key, value]) => (
          <View
            key={key}
            style={{
              minWidth: "46%",
              flexGrow: 1,
              borderRadius: radius.lg,
              backgroundColor: colors.surface2,
              padding: space.sm,
            }}
          >
            <Text size="xs" tone="muted">
              {t(key)}
            </Text>
            <Text weight="heavy" style={{ writingDirection: "ltr" }}>
              {key === "proPerformance.response"
                ? value == null || !Number.isFinite(Number(value))
                  ? "—"
                  : t("proPerformance.minutes", {
                      count: Math.round(Number(value)),
                    })
                : pct(value as number | null)}
            </Text>
          </View>
        ))}
      </View>
      {tip ? (
        <Text size="sm" tone="muted">
          {t(tip.key, tip.params)}
        </Text>
      ) : null}
    </View>
  );
}