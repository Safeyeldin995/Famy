import { scheduleDateLabel } from "@/lib/provider/scheduleDate";
import { WeeklyHoursEditor } from "@/components/provider/WeeklyHoursEditor";
import { ScheduleDateSheet } from "@/components/provider/ScheduleDateSheet";
import { NumberStepper } from "@/components/famio/NumberStepper";
import { hasSharedWorkingHours, type WorkingRule } from "@/lib/provider/setupHelpers";
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
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/pro/availability")({ component: AvailabilityPage });

export function AvailabilityPage() {
  const { t, i18n } = useTranslation();
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

  const [rows, setRows] = useState<WorkingRule[]>([]);
  const [sameHours, setSameHours] = useState(() => hasSharedWorkingHours(availQ.data ?? []));
  const [dateSheet, setDateSheet] = useState<"vacation" | "holiday" | null>(null);
  const [rules, setRules] = useState({ buffer_minutes: "30", min_notice_hours: "4", max_advance_days: "60" });

  useEffect(() => {
    if (availQ.data) {
      // Preserve the existing one-row-per-day editor contract.
      const loaded = Array.from({ length: 7 }, (_, weekday) => availQ.data.find(row => row.weekday === weekday)).filter(row => row != null).map(row => ({ weekday: row.weekday, start_time: row.start_time.slice(0, 5), end_time: row.end_time.slice(0, 5) }));
      setRows(loaded);
      setSameHours(hasSharedWorkingHours(availQ.data));
    }
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
      rules: rows.map((r) => ({ weekday: r.weekday, start_time: r.start_time, end_time: r.end_time })),
    });
  };

  const saveRules = () => {
    updateProv.mutate({
      buffer_minutes: Math.max(0, parseInt(rules.buffer_minutes) || 0),
      min_notice_hours: Math.max(0, parseInt(rules.min_notice_hours) || 0),
      max_advance_days: Math.max(1, parseInt(rules.max_advance_days) || 1),
    });
  };

  return (
    <ProviderShell>
      <ProviderPageHero title={t("pro.schedule.title")} compact />
      <div className="apply-ui space-y-5 px-5 pb-28 pt-2">
        <section>
          <h2 className="apply-label">{t("scheduleUi.hours")}</h2>
          {availQ.isError ? <QueryError compact onRetry={() => availQ.refetch()} /> : <Card className="p-4"><fieldset disabled={availQ.isLoading || save.isPending}><WeeklyHoursEditor value={rows} onChange={setRows} sameHours={sameHours} onSameHoursChange={setSameHours} /></fieldset></Card>}
          <PrimaryButton onClick={handleSave} disabled={save.isPending || availQ.isError || availQ.isLoading} className="mt-4">{t(save.isPending ? "pro.common.saving" : "pro.schedule.saveSchedule")}</PrimaryButton>
          {save.isError && <p role="alert" className="mt-2 text-sm text-destructive">{t("pro.schedule.saveError")}</p>}
          {save.isSuccess && !save.isError && <p className="mt-2 text-sm text-success">{t("pro.common.saved")}</p>}
        </section>
        <Card className="p-4">
          <button type="button" aria-label={t("pro.schedule.vacationMode")} aria-pressed={!!provider.vacation_mode} disabled={updateProv.isPending} onClick={() => updateProv.mutate({ vacation_mode: !provider.vacation_mode })} className="flex min-h-11 w-full items-center justify-between gap-3 text-start">
            <span className="font-bold">{t("scheduleUi.vacation")}</span><span className={`rounded-full px-3 py-2 text-sm font-bold ${provider.vacation_mode ? "bg-brand/10 text-brand" : "bg-surface-2 text-muted-foreground"}`}>{t(provider.vacation_mode ? "scheduleUi.on" : "scheduleUi.off")}</span>
          </button>
          <p className="text-xs text-muted-foreground">{t("pro.schedule.vacationSub")}</p>
        </Card>
        {(["vacation", "holiday"] as const).map(kind => <section key={kind}>
          <div className="flex min-h-11 items-center justify-between gap-3"><h2 className="font-extrabold">{t(kind === "vacation" ? "scheduleUi.vacations" : "scheduleUi.holidays")}</h2><button type="button" className="min-h-11 px-3 font-bold text-brand" onClick={() => setDateSheet(kind)}>{t("scheduleUi.add")}</button></div>
          {(kind === "vacation" ? vacQ : excQ).isError ? <QueryError compact onRetry={() => (kind === "vacation" ? vacQ : excQ).refetch()} /> : <Card className="divide-y divide-border/50 px-4">
            {(kind === "vacation" ? vacQ.data ?? [] : excQ.data ?? []).map(item => <div key={item.id} className="flex min-h-16 items-center justify-between gap-3 py-2">
              <div className="min-w-0 text-sm font-bold"><p>{"start_date" in item ? t("scheduleUi.dateRange", { start: scheduleDateLabel(item.start_date, i18n.language), end: scheduleDateLabel(item.end_date, i18n.language) }) : scheduleDateLabel(item.date, i18n.language, true)}</p>{item.reason && <p className="text-xs font-normal text-muted-foreground">{item.reason}</p>}</div>
              <button type="button" aria-label={t("common.delete")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-destructive" onClick={() => (kind === "vacation" ? delVac : delExc).mutate({ id: item.id, providerId: provider.id })}><Trash2 size={18} /></button>
            </div>)}
          </Card>}
        </section>)}
        <details className="rounded-2xl border border-border/50 p-4">
          <summary className="min-h-11 cursor-pointer font-bold">{t("pro.schedule.advanced")}</summary>
          <div className="space-y-4">
            {([ ["buffer_minutes", "bufferMinutes", "minutes", 0, 5], ["min_notice_hours", "minNoticeHours", "hoursUnit", 0, 1], ["max_advance_days", "maxAdvanceDays", "days", 1, 1] ] as const).map(([key, label, unit, min, step]) => <div key={key}>
              <p className="apply-label">{t(`pro.schedule.${label}`)}</p><p className="mb-2 text-xs text-muted-foreground">{t(`pro.schedule.${label}Example`)}</p>
              <NumberStepper value={Number(rules[key])} min={min} max={Number.MAX_SAFE_INTEGER} step={step} unitLabel={t(`scheduleUi.${unit}`)} onChange={value => setRules(current => ({ ...current, [key]: String(value) }))} />
            </div>)}
            <PrimaryButton onClick={saveRules} disabled={updateProv.isPending}>{t(updateProv.isPending ? "pro.common.saving" : "pro.schedule.saveRules")}</PrimaryButton>
          </div>
        </details>
        {dateSheet && <ScheduleDateSheet range={dateSheet === "vacation"} busy={dateSheet === "vacation" ? addVac.isPending : addExc.isPending} error={dateSheet === "vacation" ? addVac.isError : addExc.isError} onClose={() => setDateSheet(null)} onSave={(start, end, reason) => {
          const options = { onSuccess: () => setDateSheet(null) };
          if (dateSheet === "vacation") addVac.mutate({ providerId: provider.id, start_date: start, end_date: end, reason: reason || undefined }, options);
          else addExc.mutate({ providerId: provider.id, date: start, reason: reason || undefined }, options);
        }} />}
      </div>
    </ProviderShell>
  );
}
