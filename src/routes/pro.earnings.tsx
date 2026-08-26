import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Card, EmptyState } from "@/components/famio/ui";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderBookings, useProviderEarnings } from "@/lib/db/provider-queries";
import { formatEGP } from "@/lib/utils";
import { TrendingUp, CheckCircle2, Clock4 } from "lucide-react";

export const Route = createFileRoute("/pro/earnings")({ component: EarningsPage });

function EarningsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const dateLoc = lang === "ar" ? "ar-EG" : "en-US";
  const p = useMyProvider();
  const provider = p.data as any;
  const e = useProviderEarnings(provider?.id);
  const bookingsQ = useProviderBookings(provider?.id);
  const completed = (bookingsQ.data ?? []).filter((b: any) => b.status === "completed")
    .sort((a: any, b: any) => +new Date(b.start_at) - +new Date(a.start_at)).slice(0, 20);

  return (
    <ProviderShell>
      <div className="safe-top px-5 pb-4 pt-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{t("pro.earnings.title")}</h1>
      </div>

      <div className="space-y-6 px-5 pb-28">
        <div className="flex flex-col justify-between rounded-[2rem] bg-brand p-6 text-brand-foreground shadow-float">
          <div>
            <div className="text-sm font-bold opacity-80 uppercase tracking-widest">{t("pro.earnings.totalEarned")}</div>
            <div className="mt-2 text-[2.5rem] font-black leading-none">{formatEGP(e.data?.total ?? 0)}</div>
          </div>
          <div className="mt-6 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-white/40" />
            <div className="text-xs font-bold opacity-90">{t("pro.earnings.fromCompleted", { count: e.data?.completedCount ?? 0 })}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><TrendingUp className="h-4 w-4" /> {t("pro.earnings.thisMonth")}</div>
            <div className="mt-3 text-2xl font-black text-foreground">{formatEGP(e.data?.mtd ?? 0)}</div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><Clock4 className="h-4 w-4" /> {t("pro.earnings.last7")}</div>
            <div className="mt-3 text-2xl font-black text-foreground">{formatEGP(e.data?.last7 ?? 0)}</div>
          </Card>
        </div>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> {t("pro.earnings.upcomingPipeline")}</div>
          <div className="mt-3 text-2xl font-black text-foreground">{formatEGP(e.data?.upcomingPipeline ?? 0)}</div>
          <div className="mt-1 text-[11px] font-medium text-muted-foreground">{t("pro.earnings.upcomingPipelineSub")}</div>
        </Card>

        <div>
          <h2 className="mb-3 px-1 text-sm font-extrabold tracking-tight text-foreground">{t("pro.earnings.recentPayouts")}</h2>
          {completed.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-border/60 p-8 text-center">
              <p className="text-sm font-bold text-muted-foreground">{t("pro.earnings.noPayoutsBody")}</p>
            </div>
          ) : (
            <Card className="divide-y divide-border/50 noPad">
              {completed.map((b: any) => {
                const sname = lang === "ar" ? (b.service?.name_ar ?? b.service?.name_en) : (b.service?.name_en ?? b.service?.name_ar);
                return (
                  <div key={b.id} className="flex items-center justify-between px-5 py-4">
                    <div className="min-w-0">
                      <div className="truncate text-base font-extrabold text-foreground">{b.customer?.full_name || t("pro.common.customer")}</div>
                      <div className="mt-0.5 text-xs font-bold text-muted-foreground">{sname} · {new Date(b.start_at).toLocaleDateString(dateLoc)}</div>
                    </div>
                    <div className="text-base font-black text-foreground">{formatEGP(Number(b.price_total ?? 0))}</div>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      </div>
    </ProviderShell>
  );
}
