import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, Chip, Card, Badge, EmptyState } from "@/components/famio/ui";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderBookings } from "@/lib/db/provider-queries";
import { bookingStatusTone, formatEGP } from "@/lib/utils";
import { Calendar, Clock } from "lucide-react";

export const Route = createFileRoute("/pro/bookings")({ component: ProBookings });

type Tab = "requests" | "upcoming" | "history";

function ProBookings() {
  const { t } = useTranslation();
  const lang = useLang();
  const dateLoc = lang === "ar" ? "ar-EG" : "en-US";
  const p = useMyProvider();
  const provider = p.data as any;
  const q = useProviderBookings(provider?.id);
  const [tab, setTab] = useState<Tab>("requests");

  const lists = useMemo(() => {
    const all = q.data ?? [];
    return {
      requests: all.filter((b: any) => b.status === "pending"),
      upcoming: all.filter((b: any) => ["confirmed", "in_progress"].includes(b.status))
        .sort((a: any, b: any) => +new Date(a.start_at) - +new Date(b.start_at)),
      history: all.filter((b: any) => ["completed", "cancelled", "no_show"].includes(b.status)),
    };
  }, [q.data]);

  const list = lists[tab];
  const tabLabel = t(`pro.bookings.${tab}`);
  const emptyBody =
    tab === "requests" ? t("pro.bookings.emptyRequests")
    : tab === "upcoming" ? t("pro.bookings.emptyUpcoming")
    : t("pro.bookings.emptyHistory");

  return (
    <ProviderShell>
      <TopBar title={t("pro.bookings.title")} />
      <div className="flex gap-2 px-5 pb-4">
        <Chip active={tab === "requests"} onClick={() => setTab("requests")}>{t("pro.bookings.requests")} ({lists.requests.length})</Chip>
        <Chip active={tab === "upcoming"} onClick={() => setTab("upcoming")}>{t("pro.bookings.upcoming")}</Chip>
        <Chip active={tab === "history"} onClick={() => setTab("history")}>{t("pro.bookings.history")}</Chip>
      </div>

      <div className="space-y-3 px-5">
        {q.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-3xl bg-surface" />)
        ) : list.length === 0 ? (
          <EmptyState emoji={tab === "requests" ? "📥" : "📅"} title={t("pro.bookings.empty", { tab: tabLabel })} body={emptyBody} />
        ) : (
          list.map((b: any) => {
            const start = new Date(b.start_at);
            const end = new Date(b.end_at);
            const hours = Math.max(1, Math.round((+end - +start) / 36e5));
            const name = b.customer?.full_name || t("pro.common.customer");
            const serviceName = lang === "ar" ? (b.service?.name_ar ?? b.service?.name_en) : (b.service?.name_en ?? b.service?.name_ar);
            return (
              <Link key={b.id} to="/pro/booking/$id" params={{ id: b.id }} className="block">
                <Card className="p-4 active:scale-[0.99] transition-transform">
                  <div className="flex items-start gap-3">
                    <img src={b.customer?.avatar_url || `https://i.pravatar.cc/100?u=${b.customer_id}`} alt={name} loading="lazy" className="h-14 w-14 rounded-2xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-bold">{name}</div>
                        <Badge tone={bookingStatusTone(b.status)}>{String(t(`pro.statuses.${b.status}`, { defaultValue: b.status }))}</Badge>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{serviceName}</div>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{start.toLocaleDateString(dateLoc, { weekday: "short", month: "short", day: "numeric" })}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{start.toLocaleTimeString(dateLoc, { hour: "numeric", minute: "2-digit" })} · {hours}h</span>
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-extrabold text-navy">{formatEGP(Number(b.price_total ?? 0))}</div>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })
        )}
      </div>
    </ProviderShell>
  );
}
