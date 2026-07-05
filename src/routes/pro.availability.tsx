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
} from "@/lib/db/provider-queries";
import { Plane, Trash2, Plus } from "lucide-react";

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
  const save = useReplaceAvailability();
  const updateProv = useUpdateProvider();
  const addVac = useAddVacation();
  const delVac = useDeleteVacation();

  const [rows, setRows] = useState<Row[]>([]);
  const [newVacStart, setNewVacStart] = useState("");
  const [newVacEnd, setNewVacEnd] = useState("");

  useEffect(() => {
    if (availQ.data) setRows(defaultRows(availQ.data));
  }, [availQ.data]);

  if (!provider) return <ProviderShell><div className="p-8 text-center text-sm">{t("pro.common.loading")}</div></ProviderShell>;

  const handleSave = () => {
    save.mutate({
      providerId: provider.id,
      rules: rows.filter((r) => r.enabled).map((r) => ({ weekday: r.weekday, start_time: r.start_time, end_time: r.end_time })),
    });
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
        <Card className="flex items-center gap-3 p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-coral/10 text-coral"><Plane className="h-5 w-5" /></div>
          <div className="flex-1">
            <div className="text-sm font-bold">{t("pro.schedule.vacationMode")}</div>
            <div className="text-xs text-muted-foreground">{t("pro.schedule.vacationSub")}</div>
          </div>
          <button
            onClick={() => updateProv.mutate({ vacation_mode: !provider.vacation_mode })}
            className={`relative h-7 w-12 rounded-full transition-colors ${provider.vacation_mode ? "bg-coral" : "bg-muted"}`}
            aria-pressed={provider.vacation_mode}
          >
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-all ${provider.vacation_mode ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </Card>

        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.schedule.weeklyHours")}</h2>
          <Card className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.weekday} className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setRows((s) => s.map((x) => x.weekday === r.weekday ? { ...x, enabled: !x.enabled } : x))}
                  className={`grid h-9 w-9 place-items-center rounded-xl text-xs font-extrabold ${r.enabled ? "bg-navy text-navy-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {t(`pro.schedule.days.${DAY_KEYS[r.weekday]}`)}
                </button>
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="time"
                    value={r.start_time}
                    disabled={!r.enabled}
                    onChange={(e) => setRows((s) => s.map((x) => x.weekday === r.weekday ? { ...x, start_time: e.target.value } : x))}
                    className="h-10 flex-1 rounded-xl border border-border bg-surface px-2 text-sm disabled:opacity-40"
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <input
                    type="time"
                    value={r.end_time}
                    disabled={!r.enabled}
                    onChange={(e) => setRows((s) => s.map((x) => x.weekday === r.weekday ? { ...x, end_time: e.target.value } : x))}
                    className="h-10 flex-1 rounded-xl border border-border bg-surface px-2 text-sm disabled:opacity-40"
                  />
                </div>
              </div>
            ))}
          </Card>
          <PrimaryButton onClick={handleSave} disabled={save.isPending} className="mt-3">
            {save.isPending ? t("pro.common.saving") : t("pro.schedule.saveSchedule")}
          </PrimaryButton>
          {save.isSuccess && <div className="mt-2 text-center text-xs font-semibold text-success">{t("pro.common.saved")}</div>}
        </div>

        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.schedule.vacations")}</h2>
          <Card className="p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground">{t("pro.schedule.start")}</label>
                <input type="date" value={newVacStart} onChange={(e) => setNewVacStart(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground">{t("pro.schedule.end")}</label>
                <input type="date" value={newVacEnd} onChange={(e) => setNewVacEnd(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-2 text-sm" />
              </div>
              <button onClick={addVacation} disabled={!newVacStart || !newVacEnd || addVac.isPending} className="h-10 rounded-xl bg-navy px-4 text-sm font-bold text-navy-foreground disabled:opacity-50 inline-flex items-center gap-1"><Plus className="h-4 w-4" /> {t("pro.schedule.add")}</button>
            </div>
            {(vacQ.data ?? []).length > 0 && (
              <ul className="mt-3 divide-y divide-border">
                {vacQ.data!.map((v: any) => (
                  <li key={v.id} className="flex items-center justify-between py-2.5">
                    <div className="text-sm font-semibold">{v.start_date} → {v.end_date}</div>
                    <button onClick={() => delVac.mutate({ id: v.id, providerId: provider.id })} className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:text-coral"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </ProviderShell>
  );
}
