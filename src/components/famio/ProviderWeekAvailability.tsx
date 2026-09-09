import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

type AvailabilityRule = {
  weekday: number;
  start_time: string;
  end_time: string;
};

function startOfWeekMonday(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d;
}

function isSameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function parseTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const d = new Date();
  d.setHours(hours, minutes ?? 0, 0, 0);
  return d;
}

function formatTimeRange(start: string, end: string, locale: string) {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const from = parseTime(start).toLocaleTimeString(locale, opts);
  const to = parseTime(end).toLocaleTimeString(locale, opts);
  return `${from} – ${to}`;
}

function groupRulesByWeekday(rules: AvailabilityRule[]) {
  const map = new Map<number, AvailabilityRule[]>();
  for (const rule of rules) {
    const list = map.get(rule.weekday) ?? [];
    list.push(rule);
    map.set(rule.weekday, list);
  }
  return map;
}

export function ProviderWeekAvailability({
  rules,
  loading,
  locale,
}: {
  rules: AvailabilityRule[];
  loading: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const today = useMemo(() => new Date(), []);
  const weekDays = useMemo(() => {
    const monday = startOfWeekMonday(today);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return { date, weekday: date.getDay() };
    });
  }, [today]);

  const rulesByWeekday = useMemo(() => groupRulesByWeekday(rules), [rules]);
  const hasAvailability = rulesByWeekday.size > 0;

  const defaultWeekday = useMemo(() => {
    const todayWeekday = today.getDay();
    if (rulesByWeekday.has(todayWeekday)) return todayWeekday;
    const firstOpen = weekDays.find((day) => rulesByWeekday.has(day.weekday));
    return firstOpen?.weekday ?? todayWeekday;
  }, [rulesByWeekday, today, weekDays]);

  const [selectedWeekday, setSelectedWeekday] = useState(defaultWeekday);

  useEffect(() => {
    setSelectedWeekday(defaultWeekday);
  }, [defaultWeekday]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-[4.5rem] min-w-[3.25rem] flex-1 animate-pulse rounded-[1.25rem] bg-surface-2" />
          ))}
        </div>
        <div className="h-24 animate-pulse rounded-[1.25rem] bg-surface-2" />
      </div>
    );
  }

  if (!hasAvailability) {
    return (
      <p className="text-sm font-medium text-muted-foreground">
        {t("providerProfile.noAvailability")}
      </p>
    );
  }

  const selectedDay = weekDays.find((day) => day.weekday === selectedWeekday) ?? weekDays[0];
  const selectedRules = rulesByWeekday.get(selectedWeekday) ?? [];
  const selectedOpen = selectedRules.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {weekDays.map((day) => {
          const open = rulesByWeekday.has(day.weekday);
          const selected = selectedWeekday === day.weekday;
          const isToday = isSameCalendarDay(day.date, today);
          const dayLabel = day.date.toLocaleDateString(locale, { weekday: "short" });

          return (
            <button
              key={day.date.toISOString()}
              type="button"
              onClick={() => setSelectedWeekday(day.weekday)}
              className={`focus-ring tap-scale relative flex min-w-[3.25rem] flex-1 flex-col items-center rounded-[1.25rem] border px-2 py-3 transition-all ${
                selected
                  ? open
                    ? "border-success bg-success text-white shadow-[0_10px_24px_-14px_var(--success)]"
                    : "border-destructive bg-destructive text-destructive-foreground shadow-[0_10px_24px_-14px_var(--destructive)]"
                  : open
                    ? "border-success/25 bg-success/12 text-success"
                    : "border-destructive/25 bg-destructive/10 text-destructive"
              }`}
            >
              {isToday ? (
                <span
                  className={`absolute -top-1 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase leading-none ${
                    selected
                      ? "bg-white/20 text-white"
                      : open
                        ? "bg-success text-white"
                        : "bg-destructive text-destructive-foreground"
                  }`}
                >
                  {t("providerProfile.todayLabel")}
                </span>
              ) : null}
              <span className="mt-1 text-[10px] font-extrabold uppercase leading-none">
                {dayLabel}
              </span>
              <span className="mt-1 text-lg font-black leading-none">
                {day.date.toLocaleDateString(locale, { day: "numeric" })}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={`rounded-[1.25rem] border p-4 ${
          selectedOpen
            ? "border-success/25 bg-success/[0.06]"
            : "border-destructive/25 bg-destructive/[0.06]"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
              selectedOpen
                ? "bg-success text-white"
                : "bg-destructive text-destructive-foreground"
            }`}
          >
            <Clock className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-foreground">
              {selectedDay.date.toLocaleDateString(locale, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </p>
            {selectedOpen ? (
              <div className="mt-1 space-y-1">
                {selectedRules.map((rule, index) => (
                  <p key={`${rule.weekday}-${index}`} className="text-base font-bold text-success">
                    {formatTimeRange(rule.start_time, rule.end_time, locale)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm font-semibold text-destructive">
                {t("providerProfile.closedDay")}
              </p>
            )}
            <p className="mt-2 text-[11px] font-semibold leading-relaxed text-muted-foreground">
              {t("providerProfile.availabilityHint")}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {weekDays.map((day) => {
          const open = rulesByWeekday.has(day.weekday);
          const dayRules = rulesByWeekday.get(day.weekday) ?? [];
          const isToday = isSameCalendarDay(day.date, today);
          const selected = selectedWeekday === day.weekday;

          return (
            <button
              key={`summary-${day.date.toISOString()}`}
              type="button"
              onClick={() => setSelectedWeekday(day.weekday)}
              className={`focus-ring flex w-full items-center justify-between gap-3 rounded-[1rem] border px-3 py-2.5 text-start transition-colors ${
                selected
                  ? open
                    ? "border-success/30 bg-success/12"
                    : "border-destructive/30 bg-destructive/10"
                  : open
                    ? "border-success/15 bg-success/[0.05] hover:bg-success/10"
                    : "border-destructive/15 bg-destructive/[0.04] hover:bg-destructive/10"
              }`}
            >
              <span className="text-sm font-extrabold text-foreground">
                {day.date.toLocaleDateString(locale, { weekday: "short", day: "numeric" })}
                {isToday ? (
                  <span
                    className={`ms-2 text-[10px] font-bold uppercase ${
                      open ? "text-success" : "text-destructive"
                    }`}
                  >
                    {t("providerProfile.todayLabel")}
                  </span>
                ) : null}
              </span>
              <span
                className={`shrink-0 text-xs font-bold ${open ? "text-success" : "text-destructive"}`}
              >
                {open
                  ? dayRules
                      .map((rule) => formatTimeRange(rule.start_time, rule.end_time, locale))
                      .join(" · ")
                  : t("providerProfile.closedDay")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
