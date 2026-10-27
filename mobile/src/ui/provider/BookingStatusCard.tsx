import { View } from "react-native";
import { Check } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

const steps = ["accepted", "onTheWay", "arrived", "started", "completed"] as const;
const indexes: Record<string, number> = {
  confirmed: 0,
  on_the_way: 1,
  arrived: 2,
  arrival_confirmed: 2,
  in_progress: 3,
  completion_requested: 3,
  completed: 4,
};

export function BookingStatusCard({ status }: { status: string }) {
  const { t } = useTranslation();
  const index = indexes[status] ?? -1;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.xl,
        backgroundColor: colors.surface,
        padding: 16,
        gap: 12,
      }}
    >
      <Text
        weight="bold"
        size="xs"
        tone={status === "completed" ? "success" : status === "pending" ? "muted" : "brand"}
        style={{
          alignSelf: "flex-start",
          backgroundColor: status === "pending" ? "#FFF5DF" : colors.brandTint,
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 7,
        }}
      >
        {t(`pro.statuses.${status}`, status)}
      </Text>
      {!["cancelled", "no_show", "disputed"].includes(status) ? (
        <View
          style={{
            gap: space.sm,
            borderStartWidth: 2,
            borderColor: colors.border,
            paddingStart: 12,
          }}
        >
          {steps.map((step, position) => (
            <View key={step} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: position <= index ? colors.brand : colors.surface2,
                }}
              >
                {position <= index ? (
                  <Check size={12} color={colors.brandForeground} />
                ) : (
                  <Text size="xs" tone="muted">
                    {position + 1}
                  </Text>
                )}
              </View>
              <Text
                size="sm"
                weight={position <= index ? "bold" : "regular"}
                tone={position <= index ? "brand" : "muted"}
              >
                {t(`proRound2.${step}`)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
