import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react-native";
import { scheduleTimeChoices, timeChoiceLabel } from "@shared/provider/scheduleDate";
import { BottomSheetSelect } from "./BottomSheetSelect";
import {
  hasSharedWorkingHours,
  setSharedWorkingHours,
  type WorkingRule,
} from "@/lib/provider/availabilityHelpers";

import { Text } from "@/ui/Text";
import { colors, radius, space } from "@/ui/theme";

const chipOrder = [6, 0, 1, 2, 3, 4, 5];
const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function WeeklyHoursEditor({
  value,
  onChange,
  sameHours,
  onSameHoursChange,
  disabled = false,
}: {
  value: WorkingRule[];
  onChange: (value: WorkingRule[]) => void;
  sameHours: boolean;
  onSameHoursChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const direction = {
    direction: "ltr" as const,
    flexDirection: i18n.language.startsWith("ar") ? ("row-reverse" as const) : ("row" as const),
  };
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

  const selectTime = (row: WorkingRule, key: "start_time" | "end_time", next: string) => {
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
        accessibilityLabel={t("providerSetup.sameHours")}
        accessibilityState={{ checked: sameHours, disabled }}
        disabled={disabled}
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
        style={[
          direction,
          { minHeight: 44, alignItems: "center", gap: 10, opacity: disabled ? 0.5 : 1 },
        ]}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: sameHours ? colors.brand : colors.border,
            backgroundColor: sameHours ? colors.brand : colors.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {sameHours && <Check size={14} color="white" />}
        </View>
        <Text weight="bold">{t("providerSetup.sameHours")}</Text>
      </Pressable>
      <View style={[direction, { flexWrap: "wrap", gap: 8 }]}>
        {chipOrder.map((weekday) => {
          const on = value.some((row) => row.weekday === weekday);
          return (
            <Pressable
              key={weekday}
              accessibilityRole="button"
              accessibilityLabel={t(`pro.schedule.days.${dayKeys[weekday]}`)}
              accessibilityState={{ selected: on, disabled }}
              disabled={disabled}
              onPress={() => toggleDay(weekday)}
              style={{
                ...direction,
                gap: 6,
                opacity: disabled ? 0.5 : 1,
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
              {on && <Check size={14} color={colors.brand} />}
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
          <View style={[direction, { gap: 12 }]}>
            {(["start_time", "end_time"] as const).map((key) => (
              <BottomSheetSelect
                key={key}
                disabled={disabled}
                label={t(key === "start_time" ? "pro.schedule.start" : "pro.schedule.end")}
                value={row[key]}
                options={scheduleTimeChoices(row[key], key === "end_time").map((time) => ({
                  value: time,
                  label: timeChoiceLabel(time, i18n.language),
                }))}
                onChange={(time) => selectTime(row, key, time)}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export { hasSharedWorkingHours };
