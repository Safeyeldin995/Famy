import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, PrimaryButton } from "@/components/famio/ui";
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

function AvailabilityPage() {
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
      <TopBar title={t("pro.schedule.title")} />
      <div className="space-y-5 px-5 pb-6">
        <Card className="flex items-center gap-4 p-5">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-brand"><Plane className="h-6 w-6" strokeWidth={1.5} /></div>
          <div className="flex-1">
            <div className="text-base font-extrabold text-foreground">{t("pro.schedule.vacationMode")}</div>
            <div className="text-xs font-medium text-muted-foreground mt-0.5">{t("pro.schedule.vacationSub")}</div>
          </div>
          <button
            onClick={() => updateProv.mutate({ vacation_mode: !provider.vacation_mode })}
            className={`relative h-7 w-12 rounded-full transition-colors ${provider.vacation_mode ? "bg-brand" : "bg-muted"}`}
            aria-pressed={provider.vacation_mode}
          >
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-all ${provider.vacation_mode ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </Card>

        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">{t("pro.schedule.weeklyHours")}</h2>
          <Card className="divide-y divide-border/50 noPad">
            {rows.map((r) => (
              <div key={r.weekday} className="flex items-center gap-3 px-5 py-4">
                <button
                  onClick={() => setRows((s) => s.map((x) => x.weekday === r.weekday ? { ...x, enabled: !x.enabled } : x))}
                  className={`grid h-10 w-12 place-items-center rounded-2xl text-[11px] font-black uppercase tracking-wider transition-colors ${r.enabled ? "bg-brand text-brand-foreground" : "bg-surface-2 text-muted-foreground"}`}
                >
                  {t(`pro.schedule.days.${DAY_KEYS[r.weekday]}`)}
                </button>
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="time"
                    value={r.start_time}
                    disabled={!r.enabled}
                    onChange={(e) => setRows((s) => s.map((x) => x.weekday === r.weekday ? { ...x, start_time: e.target.value } : x))}
                    className="h-10 flex-1 rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none disabled:opacity-40"
                  />
                  <span className="text-xs font-bold text-muted-foreground">→</span>
                  <input
                    type="time"
                    value={r.end_time}
                    disabled={!r.enabled}
                    onChange={(e) => setRows((s) => s.map((x) => x.weekday === r.weekday ? { ...x, end_time: e.target.value } : x))}
                    className="h-10 flex-1 rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none disabled:opacity-40"
                  />
                </div>
              </div>
            ))}
          </Card>
          <PrimaryButton onClick={handleSave} disabled={save.isPending} className="mt-4">
            {save.isPending ? t("pro.common.saving") : t("pro.schedule.saveSchedule")}
          </PrimaryButton>
          {save.isSuccess && <div className="mt-3 text-center text-xs font-bold text-success">{t("pro.common.saved")}</div>}
        </div>

        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">{t("pro.schedule.vacations")}</h2>
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
        </div>

        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">{t("pro.schedule.holidays")}</h2>
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
        </div>

        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">{t("pro.schedule.bookingRules")}</h2>
          <Card className="flex flex-col sm:flex-row items-start sm:items-center gap-5 p-5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/10 text-brand"><Timer className="h-6 w-6" strokeWidth={1.5} /></div>
            <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3 w-full">
              <label className="block">
                <span className="text-xs font-bold text-muted-foreground">{t("pro.schedule.bufferMinutes")}</span>
                <input type="number" min={0} step={5} value={rules.buffer_minutes} onChange={(e) => setRules({ ...rules, buffer_minutes: e.target.value })}
                  className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-muted-foreground">{t("pro.schedule.minNoticeHours")}</span>
                <input type="number" min={0} step={1} value={rules.min_notice_hours} onChange={(e) => setRules({ ...rules, min_notice_hours: e.target.value })}
                  className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-muted-foreground">{t("pro.schedule.maxAdvanceDays")}</span>
                <input type="number" min={1} step={1} value={rules.max_advance_days} onChange={(e) => setRules({ ...rules, max_advance_days: e.target.value })}
                  className="mt-1.5 h-11 w-full rounded-xl border border-border/60 bg-surface px-3 text-sm font-semibold text-foreground focus:border-brand focus:outline-none" />
              </label>
            </div>
          </Card>
          <PrimaryButton onClick={saveRules} disabled={updateProv.isPending} className="mt-4">
            {updateProv.isPending ? t("pro.common.saving") : t("pro.schedule.saveRules")}
          </PrimaryButton>
        </div>
      </div>
    </ProviderShell>
  );
}
