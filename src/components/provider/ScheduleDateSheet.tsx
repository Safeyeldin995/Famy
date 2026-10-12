import { useState } from "react";
import { Drawer } from "vaul";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheetSelect } from "@/components/famio/BottomSheetSelect";
import { TextField } from "@/components/famio/TextField";
import { scheduleDate, scheduleYears, scheduleToday, scheduleMonthDays, updateScheduleDate, validateScheduleRange } from "@/lib/provider/scheduleDate";

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
  const [start, setStart] = useState(() => scheduleToday(new Date()));
  const [selectedEnd, setEnd] = useState<typeof start | null>(null);
  const end = selectedEnd ?? start;
  const [submitted, setSubmitted] = useState(false);
  const [reason, setReason] = useState("");
  const startDate = scheduleDate(start);
  const endDate = range ? scheduleDate(end) : startDate;
  const numbers = (first: number, length: number) =>
    Array.from({ length }, (_, i) => ({ value: String(first + i), label: String(first + i) }));
  const options = {
    month: numbers(1, 12),
    year: scheduleYears(new Date()).map((year) => ({ value: String(year), label: String(year) })),
  };
  const validation = validateScheduleRange(startDate, endDate, new Date());
  const validationMessage = validation === "startPast" ? t("pro.schedule.startPast")
    : validation === "endBeforeStart" ? t("pro.schedule.endBeforeStart") : t("pro.schedule.invalidDate");
  return (
    <Drawer.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Drawer.Content
          className="apply-ui apply-sheet space-y-4"
          dir={i18n.dir()}
          aria-describedby={undefined}
        >
          <div className="apply-grab" />
          <div className="flex items-center justify-between">
            <Drawer.Title className="text-lg font-extrabold">
              {t(range ? "scheduleUi.vacations" : "scheduleUi.holidays")}
            </Drawer.Title>
            <button
              type="button"
              className="apply-back"
              disabled={busy}
              onClick={onClose}
              aria-label={t("providerApply.close")}
            >
              <X size={18} />
            </button>
          </div>
          {(range ? (["start", "end"] as const) : (["start"] as const)).map((side) => (
            <fieldset key={side} disabled={busy}>
              <legend className="apply-label">
                {t(
                  side === "end"
                    ? "pro.schedule.vacationEnd"
                    : range
                      ? "pro.schedule.vacationStart"
                      : "pro.schedule.holidayDate",
                )}
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {(["day", "month", "year"] as const).map((key) => (
                  <BottomSheetSelect
                    nested
                    key={key}
                    label={t(`providerSetup.${key}`)}
                    value={(side === "start" ? start : end)[key]}
                    options={key === "day" ? numbers(1, scheduleMonthDays((side === "start" ? start : end).year, (side === "start" ? start : end).month)) : options[key]}
                    onChange={(value) => {
                      if (side === "start") setStart(updateScheduleDate(start, key, value));
                      else setEnd(updateScheduleDate(end, key, value));
                    }}
                  />
                ))}
              </div>
            </fieldset>
          ))}
          <TextField
            label={t("scheduleUi.reason")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
          />
          {submitted && validation && <p role="alert" className="text-sm text-destructive">{validationMessage}</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t("providerApply.saveError")}
            </p>
          )}
          <button
            type="button"
            className="apply-cta w-full"
            disabled={busy || !startDate || !endDate}
            onClick={() => {
              setSubmitted(true);
              if (!validateScheduleRange(startDate, endDate, new Date()) && startDate && endDate) onSave(startDate, endDate, reason);
            }}
          >
            {t(busy ? "pro.common.saving" : "pro.schedule.add")}
          </button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
