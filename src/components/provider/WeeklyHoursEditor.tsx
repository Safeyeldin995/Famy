import { scheduleTimeChoices, timeChoiceLabel } from "@/lib/provider/scheduleDate";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheetSelect } from "@/components/famio/BottomSheetSelect";
import { CheckChip } from "@/components/famio/CheckChip";
import { setSharedWorkingHours, type WorkingRule } from "@/lib/provider/setupHelpers";

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
  const { t, i18n } = useTranslation();
  const sortedRows = [...value].sort(
    (a, b) => chipOrder.indexOf(a.weekday) - chipOrder.indexOf(b.weekday),
  );
  return (
    <div className="space-y-4">
      <label className="apply-agree min-h-11">
        <input
          className="sr-only peer"
          type="checkbox"
          checked={sameHours}
          onChange={(event) => {
            onSameHoursChange(event.target.checked);
            if (event.target.checked)
              onChange(
                setSharedWorkingHours(
                  value,
                  value[0]?.start_time ?? "09:00",
                  value[0]?.end_time ?? "17:00",
                ),
              );
          }}
        />
        <span
          aria-hidden="true"
          className={`apply-checkbox peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand ${sameHours ? "on" : ""}`}
        >
          {sameHours && <Check size={14} />}
        </span>
        {t("providerSetup.sameHours")}
      </label>
      <div className="flex flex-wrap gap-2">
        {chipOrder.map((weekday) => (
          <CheckChip
            key={weekday}
            selected={value.some((row) => row.weekday === weekday)}
            onClick={() =>
              onChange(
                value.some((row) => row.weekday === weekday)
                  ? value.filter((row) => row.weekday !== weekday)
                  : [
                      ...value,
                      {
                        weekday,
                        start_time: sameHours ? (value[0]?.start_time ?? "09:00") : "09:00",
                        end_time: sameHours ? (value[0]?.end_time ?? "17:00") : "17:00",
                      },
                    ],
              )
            }
          >
            {t(`pro.schedule.days.${dayKeys[weekday]}`)}
          </CheckChip>
        ))}
      </div>
      {(sameHours ? sortedRows.slice(0, 1) : sortedRows).map((row, index) => (
        <div key={`${row.weekday}-${index}`} className="space-y-2">
          {!sameHours && (
            <p className="apply-label">{t(`pro.schedule.days.${dayKeys[row.weekday]}`)}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {(["start_time", "end_time"] as const).map((key) => {
              const values = scheduleTimeChoices(row[key], key === "end_time");
              return (
                <BottomSheetSelect
                  key={key}
                  label={t(key === "start_time" ? "pro.schedule.start" : "pro.schedule.end")}
                  value={row[key]}
                  options={values.map((time) => ({
                    value: time,
                    label: timeChoiceLabel(time, i18n.language),
                  }))}
                  onChange={(time) =>
                    onChange(
                      value.map((item) =>
                        sameHours || item === row ? { ...item, [key]: time } : item,
                      ),
                    )
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
