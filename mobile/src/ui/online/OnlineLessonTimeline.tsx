import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react-native";
import {
  ONLINE_LESSON_JOURNEY_STEPS,
  onlineLessonJourneyIndex,
} from "@shared/online/onlineLessonJourney";
import { onlineLessonPaymentDeadlineMs } from "@shared/online/onlineLessonPaymentDeadline";
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";
import { money } from "@/lib/presentation";

type Props = {
  status: string;
  startAt: string;
  endAt: string;
  paymentCaptured: boolean;
  statusChangedAt?: string | null;
  amountDue?: number | null;
};

function formatCountdown(ms: number, lang: string): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return lang.startsWith("ar")
      ? `${h} س ${m} د`
      : `${h}h ${m}m`;
  }
  return lang.startsWith("ar") ? `${m} د ${s} ث` : `${m}m ${s}s`;
}

export function OnlineLessonTimeline({
  status,
  startAt,
  endAt,
  paymentCaptured,
  statusChangedAt,
  amountDue,
}: Props) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const index = onlineLessonJourneyIndex(status, paymentCaptured, now, startAt, endAt);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const payMs =
    status === "confirmed" && !paymentCaptured && statusChangedAt
      ? onlineLessonPaymentDeadlineMs(statusChangedAt, startAt)
      : null;

  const nextKey =
    index >= 0 ? (`onlineLesson.journey.next.${ONLINE_LESSON_JOURNEY_STEPS[index]}` as const) : null;

  return (
    <View style={{ gap: space.sm, paddingVertical: space.sm }}>
      {nextKey ? (
        <Text size="sm" weight="bold">
          {t(nextKey)}
        </Text>
      ) : null}
      {payMs != null && payMs > 0 ? (
        <Text size="sm" tone="brand" weight="bold">
          {t("onlineLesson.payCountdown", { time: formatCountdown(payMs, i18n.language) })}
          {amountDue != null ? ` · ${money(amountDue, i18n.language)}` : ""}
        </Text>
      ) : null}
      <View
        accessibilityRole="list"
        style={{ gap: space.sm, borderStartWidth: 2, borderColor: colors.border, paddingStart: space.md }}
      >
        {ONLINE_LESSON_JOURNEY_STEPS.map((step, position) => {
          const done = index >= 0 && position <= index;
          const active = index === position;
          return (
            <View key={step} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
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
              <Text
                size="sm"
                weight={active ? "heavy" : done ? "bold" : "regular"}
                tone={active ? "brand" : done ? "default" : "muted"}
                style={{ flex: 1 }}
              >
                {t(`onlineLesson.journey.steps.${step}`)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}