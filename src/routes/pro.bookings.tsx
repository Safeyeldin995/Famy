import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, SegmentedControl, Card, EmptyState, Avatar, StatusPill } from "@/components/famio/ui";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderBookings } from "@/lib/db/provider-queries";
import { formatEGP, BOOKING_ACTIVE_STATUSES } from "@/lib/utils";
import { Calendar, Clock } from "lucide-react";

export const Route = createFileRoute("/pro/bookings")({ component: ProBookings });

type Tab = "requests" | "upcoming" | "history";

function statusTone(status: string): "brand" | "success" | "warning" | "muted" {
  if (status === "pending") return "warning";
  if (status === "completed") return "success";
  if (status === "cancelled" || status === "no_show") return "muted";
  return "brand";
}

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
      upcoming: all
        .filter((b: any) => BOOKING_ACTIVE_STATUSES.includes(b.status))
        .sort((a: any, b: any) => +new Date(a.start_at) - +new Date(b.start_at)),
      history: all.filter((b: any) => ["completed", "cancelled", "no_show", "disputed"].includes(b.status)),
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
      <div className="px-5 pb-4">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: "requests", label: `${t("pro.bookings.requests")} (${lists.requests.length})` },
            { value: "upcoming", label: t("pro.bookings.upcoming") },
            { value: "history", label: t("pro.bookings.history") },
          ]}
        />
      </div>

      <div className="space-y-2 px-5 pb-6">
        {q.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[4.75rem] animate-pulse rounded-[1.25rem] bg-muted" />)
        ) : list.length === 0 ? (
          <EmptyState icon={tab === "requests" ? "inbox" : "calendar"} title={t("pro.bookings.empty", { tab: tabLabel })} body={emptyBody} />
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
                  <div className="flex items-center gap-3">
                    <Avatar src={b.customer?.avatar_url} alt={name} className="h-14 w-14 shrink-0 rounded-full ring-2 ring-surface-2" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-bold">{name}</div>
                        <StatusPill tone={statusTone(b.status)}>{String(t(`pro.statuses.${b.status}`, { defaultValue: b.status }))}</StatusPill>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{serviceName}</div>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{start.toLocaleDateString(dateLoc, { weekday: "short", month: "short", day: "numeric" })}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{start.toLocaleTimeString(dateLoc, { hour: "numeric", minute: "2-digit" })} · {hours}h</span>
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-extrabold text-brand">{formatEGP(Number(b.price_total ?? 0))}</div>
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
