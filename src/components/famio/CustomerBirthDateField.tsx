import "./customerForms.css";
import { customerDayKey } from "./customerDates";
import { useTranslation } from "react-i18next";
import { BottomSheetSelect } from "./BottomSheetSelect";
import { formatDate, formatNumber } from "@/lib/format";

export function birthDateDays(year: string, month: string) {
  return year && month ? new Date(Number(year), Number(month), 0).getDate() : 31;
}

export function CustomerBirthDateField({
  value,
  onChange,
  nested = false,
}: {
  value: string;
  onChange: (value: string) => void;
  nested?: boolean;
}) {
  const { t } = useTranslation();
  const [year = "", month = "", day = ""] = value.split("-");
  const [todayYear, todayMonth, todayDay] = customerDayKey().split("-").map(Number);
  const select = (index: number, next: string) => {
    const nextParts = [year, month, day];
    nextParts[index] = next;
    if (nextParts[0] === String(todayYear) && Number(nextParts[1]) > todayMonth) nextParts[1] = "";
    const maxDay = Math.min(
      birthDateDays(nextParts[0], nextParts[1]),
      nextParts[0] === String(todayYear) && Number(nextParts[1]) === todayMonth ? todayDay : 31,
    );
    if (Number(nextParts[2]) > maxDay) nextParts[2] = "";
    // Keep partial selections controlled too, so a parent reset clears every part.
    onChange(nextParts.join("-"));
  };
  const options = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      value: String(index + 1).padStart(2, "0"),
      label: formatNumber(index + 1),
    }));
  const months = year === String(todayYear) ? todayMonth : 12;
  const days = Math.min(
    birthDateDays(year, month),
    year === String(todayYear) && Number(month) === todayMonth ? todayDay : 31,
  );
  return (
    <fieldset className="apply-ui customer-birth-date">
      <legend className="text-pro-12 font-bold text-muted-foreground">
        {t("familyMembers.dateOfBirth", "Date of birth")}
      </legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <BottomSheetSelect
          nested={nested}
          label={t("customerRound2.year", "Year")}
          value={year}
          onChange={(v) => select(0, v)}
          options={Array.from({ length: 121 }, (_, index) => ({
            value: String(todayYear - index),
            label: formatNumber(todayYear - index).replace(/[,٬]/g, ""),
          }))}
        />
        <BottomSheetSelect
          nested={nested}
          label={t("customerRound2.month", "Month")}
          value={month}
          onChange={(v) => select(1, v)}
          options={options(months).map((o) => ({
            ...o,
            label: formatDate(new Date(2020, Number(o.value) - 1, 1), { month: "long" }),
          }))}
        />
        <BottomSheetSelect
          nested={nested}
          label={t("customerRound2.day", "Day")}
          value={day}
          onChange={(v) => select(2, v)}
          options={options(days)}
        />
      </div>
    </fieldset>
  );
}
