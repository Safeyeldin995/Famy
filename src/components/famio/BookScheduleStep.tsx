import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/famio/ui";
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

const selectClass =
  "focus-ring h-12 w-full appearance-none rounded-[1.25rem] border border-border/60 bg-surface-elevated px-4 pe-10 text-sm font-bold text-foreground outline-none transition-colors focus:border-brand disabled:cursor-not-allowed disabled:opacity-60";

function ScheduleSelect({
  label,
  hint,
  value,
  onChange,
  disabled,
  children,
  tone = "default",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
  tone?: "default" | "success" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/50 bg-success/5 focus:border-success"
      : tone === "danger"
        ? "border-destructive/40 bg-destructive/[0.04] focus:border-destructive"
        : "";

  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {hint ? (
          <span className="text-[11px] font-semibold text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${selectClass} ${toneClass}`}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={ICON_STROKE_BOLD}
          aria-hidden="true"
        />
      </div>
    </label>
  );
}

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

  const selectedDateKey = date ? dateKey(date) : "";
  const showEmptyDay = !!date && !slotsLoading && !scanning && !hasSlotsForSelectedDate;
  const timeDisabled = slotsLoading || scanning || showEmptyDay || filteredSlots.length === 0;

  const formatDayLabel = (day: Date) => {
    const isToday = dateKey(day) === dateKey(today);
    const base = day.toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    return isToday ? `${base} — ${t("providerProfile.todayLabel")}` : base;
  };

  const dateTone = showEmptyDay ? "danger" : hasSlotsForSelectedDate && time ? "success" : "default";
  const timeTone = time ? "success" : showEmptyDay ? "danger" : "default";

  return (
    <div className="space-y-5">
      <ScheduleSelect
        label={t("bookFlow.datesLabel", "Date")}
        value={selectedDateKey}
        onChange={(value) => {
          const day = dayOptions.find((d) => dateKey(d) === value);
          if (day) onDateChange(day);
        }}
        tone={dateTone}
      >
        <option value="" disabled>
          {t("bookFlow.selectDate", "Select a date")}
        </option>
        {dayOptions.map((day) => (
          <option key={dateKey(day)} value={dateKey(day)}>
            {formatDayLabel(day)}
          </option>
        ))}
      </ScheduleSelect>

      <ScheduleSelect
        label={t("bookFlow.partOfDay", "Part of day")}
        value={timeBand}
        onChange={(value) => onTimeBandChange(value as TimeBand)}
        disabled={slotsLoading || scanning}
      >
        {TIME_BANDS.map((band) => (
          <option key={band.value} value={band.value}>
            {t(band.labelKey)}
          </option>
        ))}
      </ScheduleSelect>

      <div>
        <ScheduleSelect
          label={t("bookFlow.timesLabel", "Time")}
          hint={t("bookFlow.timeSub")}
          value={time ?? ""}
          onChange={(value) => {
            const slot = filteredSlots.find((s) => s.label === value);
            if (slot) onTimeChange(slot.label, { start: slot.start, end: slot.end });
          }}
          disabled={timeDisabled}
          tone={timeTone}
        >
          <option value="" disabled>
            {slotsLoading || scanning
              ? t("common.loading")
              : t("bookFlow.selectTime", "Select a time")}
          </option>
          {filteredSlots.map((slot) => (
            <option key={slot.label} value={slot.label}>
              {slot.label}
            </option>
          ))}
        </ScheduleSelect>

        {slotsLoading || scanning ? (
          <div className="mt-3 flex items-center gap-2 rounded-[1.25rem] border border-border/50 bg-surface-2/80 px-4 py-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
            <p className="text-sm font-semibold text-muted-foreground">
              {scanning
                ? t("bookFlow.scanningDates", "Finding the next available day…")
                : t("common.loading")}
            </p>
          </div>
        ) : showEmptyDay ? (
          <div className="mt-3 rounded-[1.25rem] border border-destructive/25 bg-destructive/[0.06] p-4">
            <EmptyState
              icon="calendar"
              title={t("bookFlow.noSlots")}
              body={t("bookFlow.noSlotsBody")}
            />
          </div>
        ) : filteredSlots.length === 0 && hasSlotsForSelectedDate ? (
          <p className="mt-3 text-center text-sm font-semibold text-muted-foreground">
            {t("bookFlow.noSlotsInBand", "No slots in this part of the day. Try All.")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
