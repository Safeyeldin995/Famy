import { View } from "react-native";
import { Check } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  PROVIDER_JOURNEY_STEPS,
  journeyStepTimestamps,
  journeyTimelineIndex,
  type BookingJourneySnapshot,
  type StatusHistoryRow,
} from "@shared/booking/journeyTimestamps";
import { dateTime } from "@/lib/presentation";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

type LabelNamespace = "proRound2" | "bookingJourney";

export function BookingJourneyStepper({
  status,
  booking,
  history,
  labelNamespace,
}: {
  status: string;
  booking: BookingJourneySnapshot;
  history: StatusHistoryRow[];
  labelNamespace: LabelNamespace;
}) {
  const { t, i18n } = useTranslation();
  const index = journeyTimelineIndex(status);
  const stepTimes = journeyStepTimestamps(history, booking);

  if (["cancelled", "no_show", "disputed"].includes(status)) return null;

  return (
    <View
      accessibilityRole="list"
      style={{
        gap: space.sm,
        borderStartWidth: 2,
        borderColor: colors.border,
        paddingStart: space.md,
      }}
    >
      {PROVIDER_JOURNEY_STEPS.map((step: (typeof PROVIDER_JOURNEY_STEPS)[number], position: number) => {
        const done = index >= 0 && position <= index;
        const at = stepTimes[step];
        return (
          <View
            key={step}
            accessibilityRole="text"
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: done ? colors.brand : colors.surface2,
              }}
            >
              {done ? (
                <Check size={12} color={colors.brandForeground} accessible={false} />
              ) : (
                <Text size="xs" tone="muted">
                  {position + 1}
                </Text>
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                size="sm"
                weight={done ? "bold" : "regular"}
                tone={done ? "brand" : "muted"}
              >
                {t(`${labelNamespace}.${step}`)}
              </Text>
              {done && at ? (
                <Text size="xs" tone="muted">
                  {dateTime(at, i18n.language)}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
