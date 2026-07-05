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
      <TopBar title={t("pro.earnings.title")} />
      <div className="space-y-5 px-5 pb-6">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{t("pro.earnings.totalEarned")}</div>
          <div className="mt-1 text-4xl font-extrabold text-navy">{formatEGP(e.data?.total ?? 0)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{t("pro.earnings.fromCompleted", { count: e.data?.completedCount ?? 0 })}</div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> {t("pro.earnings.thisMonth")}</div>
            <div className="mt-1 text-xl font-extrabold text-navy">{formatEGP(e.data?.mtd ?? 0)}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock4 className="h-3.5 w-3.5" /> {t("pro.earnings.last7")}</div>
            <div className="mt-1 text-xl font-extrabold text-navy">{formatEGP(e.data?.last7 ?? 0)}</div>
          </Card>
        </div>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> {t("pro.earnings.upcomingPipeline")}</div>
          <div className="mt-1 text-xl font-extrabold text-navy">{formatEGP(e.data?.upcomingPipeline ?? 0)}</div>
          <div className="text-[11px] text-muted-foreground">{t("pro.earnings.upcomingPipelineSub")}</div>
        </Card>

        <div>
          <h2 className="mb-2 px-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{t("pro.earnings.recentPayouts")}</h2>
          {completed.length === 0 ? (
            <EmptyState emoji="💼" title={t("pro.earnings.noPayouts")} body={t("pro.earnings.noPayoutsBody")} />
          ) : (
            <Card className="divide-y divide-border">
              {completed.map((b: any) => {
                const sname = lang === "ar" ? (b.service?.name_ar ?? b.service?.name_en) : (b.service?.name_en ?? b.service?.name_ar);
                return (
                  <div key={b.id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{b.customer?.full_name || t("pro.common.customer")}</div>
                      <div className="text-[11px] text-muted-foreground">{sname} · {new Date(b.start_at).toLocaleDateString(dateLoc)}</div>
                    </div>
                    <div className="text-sm font-extrabold text-navy">{formatEGP(Number(b.price_total ?? 0))}</div>
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
