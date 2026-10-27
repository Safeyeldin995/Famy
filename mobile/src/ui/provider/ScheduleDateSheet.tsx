import { useState } from "react";
import { Modal, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { BottomSheetSelect } from "./BottomSheetSelect";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, fonts, space } from "@/ui/theme";

type Parts = { year: string; month: string; day: string };
const todayParts = (): Parts => {
  const now = new Date();
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
    day: String(now.getDate()),
  };
};
const daysInMonth = (parts: Parts) =>
  new Date(Date.UTC(Number(parts.year), Number(parts.month), 0)).getUTCDate();
const update = (parts: Parts, key: keyof Parts, value: string): Parts => {
  const next = { ...parts, [key]: value };
  next.day = String(Math.min(Number(next.day), daysInMonth(next)));
  return next;
};
const serialize = ({ year, month, day }: Parts) =>
  `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
const numbers = (first: number, length: number) =>
  Array.from({ length }, (_, index) => ({
    value: String(first + index),
    label: String(first + index),
  }));

export function ScheduleDateSheet({
  range,
  busy,
  error,
  onClose,
  onSave,
}: {
  range: boolean;
  busy: boolean;
  error: boolean;
  onClose: () => void;
  onSave: (start: string, end: string, reason: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [start, setStart] = useState<Parts>(todayParts);
  const [chosenEnd, setEnd] = useState<Parts | null>(null);
  const end = chosenEnd ?? start;
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState("");
  const year = new Date().getFullYear();
  const dateField = (side: "start" | "end") => {
    const parts = side === "start" ? start : end;
    return (
      <View key={side} style={{ gap: space.sm }}>
        <Text weight="bold">
          {t(
            side === "end"
              ? "pro.schedule.vacationEnd"
              : range
                ? "pro.schedule.vacationStart"
                : "pro.schedule.holidayDate",
          )}
        </Text>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {(["day", "month", "year"] as const).map((key) => (
            <BottomSheetSelect
              key={key}
              label={t(`providerSetup.${key}`)}
              value={parts[key]}
              options={
                key === "day"
                  ? numbers(1, daysInMonth(parts))
                  : key === "month"
                    ? numbers(1, 12)
                    : numbers(year, 2)
              }
              onChange={(value) =>
                side === "start"
                  ? setStart((current) => update(current, key, value))
                  : setEnd((current) => update(current ?? start, key, value))
              }
              disabled={busy}
            />
          ))}
        </View>
      </View>
    );
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,13,16,.42)" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("providerApply.close")}
          onPress={onClose}
          style={{ flex: 1 }}
        />
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            padding: 20,
            paddingBottom: Math.max(insets.bottom, 20),
            gap: space.lg,
          }}
        >
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
              alignSelf: "center",
            }}
          />
          <View
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
          >
            <Text weight="heavy" size="lg">
              {t(range ? "scheduleUi.vacations" : "scheduleUi.holidays")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("providerApply.close")}
              onPress={onClose}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <X size={20} color={colors.foreground} />
            </Pressable>
          </View>
          {dateField("start")}
          {range ? dateField("end") : null}
          <Text weight="bold">{t("scheduleUi.reason")}</Text>
          <TextInput
            accessibilityLabel={t("scheduleUi.reason")}
            value={reason}
            onChangeText={setReason}
            style={{
              minHeight: 52,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              paddingHorizontal: 14,
              fontFamily: (i18n.language === "en" ? fonts.en : fonts.ar).regular,
              color: colors.foreground,
            }}
          />
          {validation ? <Text tone="danger">{validation}</Text> : null}
          {error ? <Text tone="danger">{t("providerApply.saveError")}</Text> : null}
          <Button
            label={t(busy ? "pro.common.saving" : "pro.schedule.add")}
            disabled={busy}
            onPress={() => {
              const first = serialize(start);
              const last = range ? serialize(end) : first;
              const today = serialize(todayParts());
              if (first < today) return setValidation(t("pro.schedule.startPast"));
              if (last < first) return setValidation(t("pro.schedule.endBeforeStart"));
              setValidation("");
              onSave(first, last, reason.trim());
            }}
          />
        </View>
      </View>
    </Modal>
  );
}
