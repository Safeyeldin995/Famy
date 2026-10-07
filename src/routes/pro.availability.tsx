import { copyWeeklyHours } from "@/lib/provider/copyWeeklyHours";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { ProviderPageHero } from "@/components/famio/ProviderPageHero";
import { Card, PrimaryButton } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import {
  useMyProvider,
  useProviderAvailability,
  useReplaceAvailability,
  useUpdateProvider,
  useProviderVacations,
  useAddVacation,
  useDeleteVacation,
  useProviderExceptions,
  useAddException,
  useDeleteException,
} from "@/lib/db/provider-queries";
import { Plane, Trash2, Plus, Timer } from "lucide-react";

export const Route = createFileRoute("/pro/availability")({ component: AvailabilityPage });

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type Row = { weekday: number; start_time: string; end_time: string; enabled: boolean };

function defaultRows(existing: any[]): Row[] {
  return DAY_KEYS.map((_, i) => {
    const r = existing.find((x) => x.weekday === i);
    return r
      ? { weekday: i, start_time: r.start_time.slice(0, 5), end_time: r.end_time.slice(0, 5), enabled: true }
      : { weekday: i, start_time: "09:00", end_time: "17:00", enabled: false };
  });
}

export function AvailabilityPage() {
  const { t } = useTranslation();
  const p = useMyProvider();
  const provider = p.data as any;
  const availQ = useProviderAvailability(provider?.id);
  const vacQ = useProviderVacations(provider?.id);
  const excQ = useProviderExceptions(provider?.id);
  const save = useReplaceAvailability();
  const updateProv = useUpdateProvider();
  const addVac = useAddVacation();
  const delVac = useDeleteVacation();
  const addExc = useAddException();
  const delExc = useDeleteException();

  const [rows, setRows] = useState<Row[]>([]);
  const [copySource, setCopySource] = useState<number | null>(null);
  const [copyDays, setCopyDays] = useState<number[]>([]);
  const [copyNotice, setCopyNotice] = useState(false);
  const [newVacStart, setNewVacStart] = useState("");
  const [newVacEnd, setNewVacEnd] = useState("");
  const [newHoliday, setNewHoliday] = useState("");
  const [newHolidayReason, setNewHolidayReason] = useState("");
  const [rules, setRules] = useState({ buffer_minutes: "30", min_notice_hours: "4", max_advance_days: "60" });

  useEffect(() => {
    if (availQ.data) setRows(defaultRows(availQ.data));
  }, [availQ.data]);

  useEffect(() => {
    if (provider) {
      setRules({
        buffer_minutes: String(provider.buffer_minutes ?? 30),
        min_notice_hours: String(provider.min_notice_hours ?? 4),
        max_advance_days: String(provider.max_advance_days ?? 60),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id]);

  if (p.isLoading) {
    return <ProviderShell><div className="p-8 text-center text-sm">{t("pro.common.loading")}</div></ProviderShell>;
  }

  if (p.isError) {
    return (
      <ProviderShell>
        <QueryError onRetry={() => p.refetch()} />
      </ProviderShell>
    );
  }

  if (!provider) return <ProviderShell><div className="p-8 text-center text-sm">{t("pro.common.loading")}</div></ProviderShell>;

  const handleSave = () => {
    save.mutate({
      providerId: provider.id,
      rules: rows.filter((r) => r.enabled).map((r) => ({ weekday: r.weekday, start_time: r.start_time, end_time: r.end_time })),
    });
  };

  const saveRules = () => {
    updateProv.mutate({
      buffer_minutes: Math.max(0, parseInt(rules.buffer_minutes) || 0),
      min_notice_hours: Math.max(0, parseInt(rules.min_notice_hours) || 0),
      max_advance_days: Math.max(1, parseInt(rules.max_advance_days) || 1),
    });
  };

  const addHoliday = () => {
    if (!newHoliday) return;
    addExc.mutate({ providerId: provider.id, date: newHoliday, reason: newHolidayReason || undefined });
    setNewHoliday(""); setNewHolidayReason("");
  };

  const addVacation = () => {
    if (!newVacStart || !newVacEnd) return;
    addVac.mutate({ providerId: provider.id, start_date: newVacStart, end_date: newVacEnd });
    setNewVacStart(""); setNewVacEnd("");
  };

  return (
    <ProviderShell>
      <ProviderPageHero title={t("pro.schedule.title")} compact />
      <div className="space-y-5 px-5 pb-28 pt-2">


        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">{t("pro.schedule.weeklyHours")}</h2>
          {availQ.isError ? (
            <QueryError compact onRetry={() => availQ.refetch()} />
          ) : (
          <Card className="divide-y divide-border/50 noPad">
            {rows.map((r) => (
              <div key={r.weekday} className="flex flex-col items-stretch gap-3 px-4 py-4 sm:flex-row sm:items-start">
                <button
                  onClick={() => setRows((s) => s.map((x) => x.weekday === r.weekday ? { ...x, enabled: !x.enabled } : x))}
                  aria-pressed={r.enabled}
                  className={`grid min-h-11 min-w-11 shrink-0 self-start px-3 place-items-center rounded-2xl text-[11px] font-black uppercase tracking-wider transition-colors ${r.enabled ? "bg-brand text-brand-foreground" : "bg-surface-2 text-muted-foreground"}`}
                >
                  {t(`pro.schedule.days.${DAY_KEYS[r.weekday]}`)}
                </button>
                <div className="flex w-full min-w-0 flex-1 items-start gap-2">
                  <input
                    type="time"
                    aria-label={`${t(`pro.schedule.days.${DAY_KEYS[r.weekday]}`)}: ${t("pro.schedule.start")}`}
                    value={r.start_time}
                    disabled={!r.enabled}
                    onChange={(e) => setRows((s) => s.map((x) => x.weekday === r.weekday ? { ...x, start_time: e.target.value } : x))}
                    className="h-11 min-w-11 w-0 flex-1 rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none disabled:opacity-40"
                  />
                  <span className="text-xs font-bold text-muted-foreground">→</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <input type="time" aria-label={`${t(`pro.schedule.days.${DAY_KEYS[r.weekday]}`)}: ${t("pro.schedule.end")}`} value={r.end_time === "24:00" ? "" : r.end_time} disabled={!r.enabled || r.end_time === "24:00"} onChange={(e) => setRows((rows) => rows.map((row) => row.weekday === r.weekday ? { ...row, end_time: e.target.value } : row))} className="h-11 min-w-11 w-full rounded-xl border border-border/60 bg-surface px-2 text-sm font-semibold disabled:opacity-40" />
                    <label className="flex min-h-11 items-center gap-1 text-xs font-semibold">
                      <input type="checkbox" checked={r.end_time === "24:00"} disabled={!r.enabled} onChange={(e) => setRows((rows) => rows.map((row) => row.weekday === r.weekday ? { ...row, end_time: e.target.checked ? "24:00" : "17:00" } : row))} />
                      {t("packages.endOfDay")}
                    </label>
                  </div>
                </div>
                {r.enabled && <div className="min-w-0 sm:max-w-48">
                  <button type="button" aria-expanded={copySource === r.weekday} className="min-h-11 min-w-11 text-start text-xs font-bold text-brand" onClick={() => { setCopySource(copySource === r.weekday ? null : r.weekday); setCopyDays([]); setCopyNotice(false); }}>
                    {t("pro.schedule.copyHours")}
                  </button>
                  {copySource === r.weekday && <fieldset className="space-y-2">
                    <legend className="text-xs text-muted-foreground">{t("pro.schedule.copyHint")}</legend>
                    <div className="flex flex-wrap gap-2">
                      {rows.filter(day => day.weekday !== r.weekday).map(day => (
                        <label key={day.weekday} className={`flex min-h-11 min-w-11 items-center gap-2 rounded-xl border border-border px-3 text-xs ${!day.enabled ? "opacity-40" : ""}`}>
                          <input type="checkbox" disabled={!day.enabled} checked={copyDays.includes(day.weekday)} onChange={(e) => setCopyDays(days => e.target.checked ? [...days, day.weekday] : days.filter(value => value !== day.weekday))} />
                          {t(`pro.schedule.days.${DAY_KEYS[day.weekday]}`)}
                        </label>
                      ))}
                    </div>
                    <button type="button" disabled={!copyDays.length} className="min-h-11 min-w-11 rounded-xl border border-brand px-4 text-sm font-bold text-brand disabled:opacity-40" onClick={() => { setRows(rows => copyWeeklyHours(rows, r.weekday, copyDays)); setCopySource(null); setCopyDays([]); setCopyNotice(true); }}>
                      {t("pro.schedule.applyCopy")}
                    </button>
                  </fieldset>}
                </div>}
              </div>
            ))}
          </Card>
          )}
          {copyNotice && <p role="status" className="mt-3 text-xs font-bold text-brand">{t("pro.schedule.copyNeedsSave")}</p>}
          <PrimaryButton onClick={handleSave} disabled={save.isPending || availQ.isError} className="mt-4">
            {save.isPending ? t("pro.common.saving") : t("pro.schedule.saveSchedule")}
          </PrimaryButton>
          {save.isError && (
            <div role="alert" className="mt-3 text-center text-xs font-bold text-destructive">
              {t("pro.schedule.saveError")}
            </div>
          )}
          {save.isSuccess && <div className="mt-3 text-center text-xs font-bold text-success">{t("pro.common.saved")}</div>}
        </div>

        <details open={!!provider.vacation_mode} className="space-y-5">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-extrabold">{t("pro.schedule.advanced")}</summary>
        <Card className="flex items-center gap-4 p-5">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-brand"><Plane className="h-6 w-6" strokeWidth={1.5} /></div>
          <div className="flex-1">
            <div className="text-base font-extrabold text-foreground">{t("pro.schedule.vacationMode")}</div>
            <div className="text-xs font-medium text-muted-foreground mt-0.5">{t("pro.schedule.vacationSub")}</div>
          </div>
          <button
            onClick={() => updateProv.mutate({ vacation_mode: !provider.vacation_mode })}
            aria-label={t("pro.schedule.vacationMode")}
            className={`relative h-11 w-12 shrink-0 rounded-full transition-colors ${provider.vacation_mode ? "bg-brand" : "bg-muted"}`}
            aria-pressed={provider.vacation_mode}
          >
            <span className={`absolute top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-white shadow-sm transition-all ${provider.vacation_mode ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </Card>
        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">{t("pro.schedule.vacations")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("pro.schedule.vacationsExample")}</p>
          {vacQ.isError ? (
            <QueryError compact onRetry={() => vacQ.refetch()} />
          ) : (
          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="text-xs font-bold text-muted-foreground">{t("pro.schedule.start")}</label>
                <input type="date" value={newVacStart} onChange={(e) => setNewVacStart(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </div>
              <div className="flex-1">
                <label className="text-xs font-bold text-muted-foreground">{t("pro.schedule.end")}</label>
                <input type="date" value={newVacEnd} onChange={(e) => setNewVacEnd(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </div>
              <button onClick={addVacation} disabled={!newVacStart || !newVacEnd || addVac.isPending} className="h-11 rounded-full bg-brand px-6 text-sm font-extrabold text-brand-foreground shadow-sm disabled:opacity-50 inline-flex items-center justify-center gap-1.5"><Plus className="h-4 w-4" strokeWidth={2.5} /> {t("pro.schedule.add")}</button>
            </div>
            {(vacQ.data ?? []).length > 0 && (
              <ul className="mt-5 divide-y divide-border/50">
                {vacQ.data!.map((v: any) => (
                  <li key={v.id} className="flex items-center justify-between py-3">
                    <div className="text-sm font-extrabold text-foreground">{v.start_date} <span className="text-muted-foreground mx-1">→</span> {v.end_date}</div>
                    <button onClick={() => delVac.mutate({ id: v.id, providerId: provider.id })} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          )}
        </div>

        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">{t("pro.schedule.holidays")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("pro.schedule.holidaysExample")}</p>
          {excQ.isError ? (
            <QueryError compact onRetry={() => excQ.refetch()} />
          ) : (
          <Card className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="text-xs font-bold text-muted-foreground">{t("pro.schedule.holidayDate")}</label>
                <input type="date" value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </div>
              <div className="flex-1">
                <label className="text-xs font-bold text-muted-foreground">{t("pro.schedule.holidayReason")}</label>
                <input value={newHolidayReason} onChange={(e) => setNewHolidayReason(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </div>
              <button onClick={addHoliday} disabled={!newHoliday || addExc.isPending} className="h-11 rounded-full bg-brand px-6 text-sm font-extrabold text-brand-foreground shadow-sm disabled:opacity-50 inline-flex items-center justify-center gap-1.5"><Plus className="h-4 w-4" strokeWidth={2.5} /> {t("pro.schedule.add")}</button>
            </div>
            {(excQ.data ?? []).length > 0 && (
              <ul className="mt-5 divide-y divide-border/50">
                {excQ.data!.map((e: any) => (
                  <li key={e.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-extrabold text-foreground">{e.date}</div>
                      {e.reason && <div className="text-[11px] font-medium text-muted-foreground mt-0.5">{e.reason}</div>}
                    </div>
                    <button onClick={() => delExc.mutate({ id: e.id, providerId: provider.id })} className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          )}
        </div>

        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">{t("pro.schedule.bookingRules")}</h2>
          <Card className="flex flex-col sm:flex-row items-start sm:items-center gap-5 p-5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/10 text-brand"><Timer className="h-6 w-6" strokeWidth={1.5} /></div>
            <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3 w-full">
              <label className="block">
                <span className="text-xs font-bold text-muted-foreground">{t("pro.schedule.bufferMinutes")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t("pro.schedule.bufferMinutesExample")}</span>
                <input type="number" min={0} step={5} value={rules.buffer_minutes} onChange={(e) => setRules({ ...rules, buffer_minutes: e.target.value })}
                  className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-muted-foreground">{t("pro.schedule.minNoticeHours")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t("pro.schedule.minNoticeHoursExample")}</span>
                <input type="number" min={0} step={1} value={rules.min_notice_hours} onChange={(e) => setRules({ ...rules, min_notice_hours: e.target.value })}
                  className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-muted-foreground">{t("pro.schedule.maxAdvanceDays")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{t("pro.schedule.maxAdvanceDaysExample")}</span>
                <input type="number" min={1} step={1} value={rules.max_advance_days} onChange={(e) => setRules({ ...rules, max_advance_days: e.target.value })}
                  className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </label>
            </div>
          </Card>
          <PrimaryButton onClick={saveRules} disabled={updateProv.isPending} className="mt-4">
            {updateProv.isPending ? t("pro.common.saving") : t("pro.schedule.saveRules")}
          </PrimaryButton>
        </div>
        </details>
      </div>
    </ProviderShell>
  );
}
