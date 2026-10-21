import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  hasSharedWorkingHours,
  setSharedWorkingHours,
  type WorkingRule,
} from "@/lib/provider/availabilityHelpers";

const TIME_CHOICES = (() => {
  const values: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      values.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  values.push("24:00");
  return values;
})();

function scheduleTimeChoices(current: string, isEnd: boolean) {
  const list = [...TIME_CHOICES];
  if (current && !list.includes(current)) list.push(current);
  list.sort();
  if (isEnd) return list.filter((t) => t !== "00:00");
  return list.filter((t) => t !== "24:00");
}
import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

const chipOrder = [6, 0, 1, 2, 3, 4, 5];
const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function WeeklyHoursEditor({
  value,
  onChange,
  sameHours,
  onSameHoursChange,
}: {
  value: WorkingRule[];
  onChange: (value: WorkingRule[]) => void;
  sameHours: boolean;
  onSameHoursChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const sortedRows = [...value].sort(
    (a, b) => chipOrder.indexOf(a.weekday) - chipOrder.indexOf(b.weekday),
  );
  const rows = sameHours ? sortedRows.slice(0, 1) : sortedRows;

  const toggleDay = (weekday: number) => {
    if (value.some((row) => row.weekday === weekday)) {
      onChange(value.filter((row) => row.weekday !== weekday));
      return;
    }
    onChange([
      ...value,
      {
        weekday,
        start_time: sameHours ? (value[0]?.start_time ?? "09:00") : "09:00",
        end_time: sameHours ? (value[0]?.end_time ?? "17:00") : "17:00",
      },
    ]);
  };

  const shiftTime = (row: WorkingRule, key: "start_time" | "end_time", delta: number) => {
    const choices = scheduleTimeChoices(row[key], key === "end_time");
    const idx = choices.indexOf(row[key]);
    const next = choices[Math.min(choices.length - 1, Math.max(0, idx + delta))];
    onChange(
      value.map((item) =>
        sameHours || item.weekday === row.weekday ? { ...item, [key]: next } : item,
      ),
    );
  };

  return (
    <View style={{ gap: space.md }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: sameHours }}
        onPress={() => {
          const next = !sameHours;
          onSameHoursChange(next);
          if (next) {
            onChange(
              setSharedWorkingHours(
                value,
                value[0]?.start_time ?? "09:00",
                value[0]?.end_time ?? "17:00",
              ),
            );
          }
        }}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text weight="bold">{t("providerSetup.sameHours")}</Text>
      </Pressable>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
        {chipOrder.map((weekday) => {
          const on = value.some((row) => row.weekday === weekday);
          return (
            <Pressable
              key={weekday}
              accessibilityRole="button"
              onPress={() => toggleDay(weekday)}
              style={{
                minHeight: 44,
                minWidth: 44,
                paddingHorizontal: space.sm,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: on ? colors.brand : colors.border,
                backgroundColor: on ? colors.brandTint : colors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text weight="bold" tone={on ? "brand" : "muted"} size="sm">
                {t(`pro.schedule.days.${dayKeys[weekday]}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {rows.map((row) => (
        <View key={row.weekday} style={{ gap: space.sm }}>
          {!sameHours && (
            <Text weight="bold" tone="muted" size="sm">
              {t(`pro.schedule.days.${dayKeys[row.weekday]}`)}
            </Text>
          )}
          {(["start_time", "end_time"] as const).map((key) => (
            <View
              key={key}
              style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 }}
            >
              <Text style={{ flex: 1 }} weight="bold">
                {t(key === "start_time" ? "pro.schedule.start" : "pro.schedule.end")}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => shiftTime(row, key, -1)}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text weight="heavy">−</Text>
              </Pressable>
              <Text weight="heavy">{row[key]}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => shiftTime(row, key, 1)}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text weight="heavy">+</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export { hasSharedWorkingHours };
