import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/famio/ui";
import { formatNumber } from "@/lib/utils";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

export type TimeBand = "all" | "morning" | "afternoon" | "evening";

export type BookSlot = {
  label: string;
  start: Date;
  end: Date;
};

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

const TIME_BANDS: { value: TimeBand; labelKey: string }[] = [
  { value: "all", labelKey: "bookFlow.timeAll" },
  { value: "morning", labelKey: "bookFlow.timeMorning" },
  { value: "afternoon", labelKey: "bookFlow.timeAfternoon" },
  { value: "evening", labelKey: "bookFlow.timeEvening" },
];

export function BookScheduleStep({
  locale,
  maxAdvanceDays,
  date,
  time,
  timeBand,
  slotsLoading,
  filteredSlots,
  hasSlotsForSelectedDate,
  scanning,
  onDateChange,
  onTimeChange,
  onTimeBandChange,
}: {
  locale: string;
  maxAdvanceDays: number;
  date: Date | null;
  time: string | null;
  timeBand: TimeBand;
  slotsLoading: boolean;
  filteredSlots: BookSlot[];
  hasSlotsForSelectedDate: boolean;
  scanning: boolean;
  onDateChange: (date: Date) => void;
  onTimeChange: (label: string, slot: { start: Date; end: Date }) => void;
  onTimeBandChange: (band: TimeBand) => void;
}) {
  const { t } = useTranslation();
  const today = useMemo(() => startOfDay(new Date()), []);

  const dayOptions = useMemo(() => {
    const count = Math.max(1, Math.min(30, maxAdvanceDays));
    return Array.from({ length: count }, (_, index) => {
      const d = new Date(today);
      d.setDate(today.getDate() + index);
      return d;
    });
  }, [maxAdvanceDays, today]);

  const selectedKey = date ? dateKey(date) : null;
  const showEmptyDay = !!date && !slotsLoading && !scanning && !hasSlotsForSelectedDate;

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
          {t("bookFlow.datesLabel", "Date")}
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {dayOptions.map((day) => {
            const selected = selectedKey === dateKey(day);
            const isToday = dateKey(day) === dateKey(today);
            const dayLabel = day.toLocaleDateString(locale, { weekday: "short" });

            let dayClass =
              "border-border/60 bg-surface-elevated text-foreground shadow-xs";
            if (selected) {
              if (slotsLoading || scanning) {
                dayClass = "border-brand/40 bg-brand/10 text-brand";
              } else if (hasSlotsForSelectedDate) {
                dayClass =
                  "border-success bg-success text-white shadow-[0_10px_24px_-14px_var(--success)]";
              } else {
                dayClass =
                  "border-destructive bg-destructive text-destructive-foreground shadow-[0_10px_24px_-14px_var(--destructive)]";
              }
            }

            return (
              <button
                key={dateKey(day)}
                type="button"
                onClick={() => onDateChange(day)}
                className={`focus-ring tap-scale relative flex min-w-[3.5rem] shrink-0 flex-col items-center rounded-[1.25rem] border px-2 py-3 transition-all ${dayClass}`}
              >
                {isToday ? (
                  <span
                    className={`absolute -top-1 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase leading-none ${
                      selected && hasSlotsForSelectedDate && !slotsLoading
                        ? "bg-white/20 text-white"
                        : selected && showEmptyDay
                          ? "bg-white/20 text-white"
                          : "bg-brand text-brand-foreground"
                    }`}
                  >
                    {t("providerProfile.todayLabel")}
                  </span>
                ) : null}
                <span className="mt-1 text-[10px] font-extrabold uppercase leading-none">
                  {dayLabel}
                </span>
                <span className="mt-1 text-lg font-black leading-none">
                  {formatNumber(day.getDate())}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold opacity-80">
                  {day.toLocaleDateString(locale, { month: "short" })}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            {t("bookFlow.timesLabel", "Time")}
          </p>
          <p className="text-[11px] font-semibold text-muted-foreground">
            {t("bookFlow.timeSub")}
          </p>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {TIME_BANDS.map((band) => {
            const active = timeBand === band.value;
            return (
              <button
                key={band.value}
                type="button"
                onClick={() => onTimeBandChange(band.value)}
                className={`focus-ring rounded-full px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide transition-all ${
                  active
                    ? "bg-foreground text-background"
                    : "bg-surface-2 text-muted-foreground"
                }`}
              >
                {t(band.labelKey)}
              </button>
            );
          })}
        </div>

        {slotsLoading || scanning ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-[1.25rem] border border-border/50 bg-surface-2/80 py-10">
            <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden="true" />
            <p className="text-sm font-semibold text-muted-foreground">
              {scanning
                ? t("bookFlow.scanningDates", "Finding the next available day…")
                : t("common.loading")}
            </p>
          </div>
        ) : showEmptyDay ? (
          <div className="rounded-[1.25rem] border border-destructive/25 bg-destructive/[0.06] p-4">
            <EmptyState
              icon="calendar"
              title={t("bookFlow.noSlots")}
              body={t("bookFlow.noSlotsBody")}
            />
          </div>
        ) : filteredSlots.length === 0 ? (
          <div className="rounded-[1.25rem] border border-border/50 bg-surface-2/80 p-4">
            <p className="text-center text-sm font-semibold text-muted-foreground">
              {t("bookFlow.noSlotsInBand", "No slots in this part of the day. Try All.")}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {filteredSlots.map((slot) => {
              const active = time === slot.label;
              return (
                <button
                  key={slot.label}
                  type="button"
                  onClick={() => onTimeChange(slot.label, { start: slot.start, end: slot.end })}
                  className={`focus-ring tap-scale inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-extrabold transition-all ${
                    active
                      ? "bg-success text-white shadow-[0_8px_20px_-10px_var(--success)]"
                      : "border border-success/25 bg-success/10 text-success hover:bg-success/15"
                  }`}
                >
                  <Clock className="h-3.5 w-3.5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
                  {slot.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
