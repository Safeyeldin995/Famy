import { View } from "react-native";
import { useTranslation } from "react-i18next";
function cairoDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(d);
}
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

type BlockedDay = {
  date: string;
  labels: string[];
};

function nextSevenCairoDays(from = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    out.push(cairoDateKey(d));
  }
  return out;
}

export function ScheduleWeekPreview({
  vacationDates,
  exceptionDates,
  bookingDays,
}: {
  vacationDates: Set<string>;
  exceptionDates: Set<string>;
  bookingDays: Set<string>;
}) {
  const { t, i18n } = useTranslation();
  const days = nextSevenCairoDays();

  const rows: BlockedDay[] = days.map((date) => {
    const labels: string[] = [];
    if (vacationDates.has(date)) labels.push(t("schedulePreview.vacation"));
    if (exceptionDates.has(date)) labels.push(t("schedulePreview.exception"));
    if (bookingDays.has(date)) labels.push(t("schedulePreview.booking"));
    return { date, labels };
  });

  return (
    <View style={{ gap: space.sm }}>
      <Text weight="heavy">{t("schedulePreview.title")}</Text>
      {rows.map((row) => {
        const [y, m, d] = row.date.split("-").map(Number);
        const label = new Intl.DateTimeFormat(
          i18n.language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB",
          { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" },
        ).format(new Date(Date.UTC(y, m - 1, d)));
        return (
          <View
            key={row.date}
            style={{
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: radius.lg,
              backgroundColor: row.labels.length ? colors.brandTint : colors.surface2,
            }}
          >
            <Text weight="bold" size="sm">
              {label}
            </Text>
            <Text tone="muted" size="xs" style={{ flex: 1, textAlign: "end" }} numberOfLines={2}>
              {row.labels.length ? row.labels.join(" · ") : t("schedulePreview.clear")}
            </Text>
          </View>
        );
      })}
    </View>
  );
}