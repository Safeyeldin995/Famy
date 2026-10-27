import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { customerDayKey } from "../../../../src/components/famio/customerDates";
import { BottomSheetSelect } from "../provider/BottomSheetSelect";
import { Text } from "../Text";

/** Web's controlled year/month/day selectors, including partial dates and future bounds. */
export function CustomerBirthDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [year = "", month = "", day = ""] = value.split("-");
  const [todayYear, todayMonth, todayDay] = customerDayKey().split("-").map(Number);
  const daysInMonth = (y: string, m: string) =>
    y && m ? new Date(Number(y), Number(m), 0).getDate() : 31;
  const select = (index: number, next: string) => {
    const parts = [year, month, day];
    parts[index] = next;
    if (parts[0] === String(todayYear) && Number(parts[1]) > todayMonth) parts[1] = "";
    const max = Math.min(
      daysInMonth(parts[0], parts[1]),
      parts[0] === String(todayYear) && Number(parts[1]) === todayMonth ? todayDay : 31,
    );
    if (Number(parts[2]) > max) parts[2] = "";
    onChange(parts.join("-"));
  };
  const options = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      value: String(index + 1).padStart(2, "0"),
      label: String(index + 1),
    }));
  const months = year === String(todayYear) ? todayMonth : 12;
  const days = Math.min(
    daysInMonth(year, month),
    year === String(todayYear) && Number(month) === todayMonth ? todayDay : 31,
  );
  return (
    <View style={{ gap: 8 }}>
      <Text size="xs" weight="bold" tone="muted">
        {t("familyMembers.dateOfBirth")}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <BottomSheetSelect
          label={t("customerRound2.year")}
          value={year}
          onChange={(v) => select(0, v)}
          options={Array.from({ length: 121 }, (_, index) => ({
            value: String(todayYear - index),
            label: String(todayYear - index),
          }))}
        />
        <BottomSheetSelect
          label={t("customerRound2.month")}
          value={month}
          onChange={(v) => select(1, v)}
          options={options(months).map((o) => ({
            ...o,
            label: new Date(2020, Number(o.value) - 1, 1).toLocaleDateString(
              i18n.language === "ar" ? "ar-EG-u-nu-latn" : "en-EG",
              { month: "long" },
            ),
          }))}
        />
        <BottomSheetSelect
          label={t("customerRound2.day")}
          value={day}
          onChange={(v) => select(2, v)}
          options={options(days)}
        />
      </View>
    </View>
  );
}
