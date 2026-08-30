import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar, SegmentedControl, Card, EmptyState, Avatar, StatusPill } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
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

  if (p.isLoading) {
    return (
      <ProviderShell>
        <div className="px-5 py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-navy/20 border-t-navy" />
        </div>
      </ProviderShell>
    );
  }

  if (p.isError) {
    return (
      <ProviderShell>
        <QueryError onRetry={() => p.refetch()} />
      </ProviderShell>
    );
  }

  const list = lists[tab];
  const tabLabel = t(`pro.bookings.${tab}`);
  const emptyBody =
    tab === "requests" ? t("pro.bookings.emptyRequests")
    : tab === "upcoming" ? t("pro.bookings.emptyUpcoming")
    : t("pro.bookings.emptyHistory");

  return (
    <ProviderShell>
      <div className="safe-top px-5 pb-4 pt-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{t("pro.bookings.title")}</h1>
      </div>
      <div className="px-5 pb-5">
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

      <div className="space-y-4 px-5 pb-28">
        {q.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-[2rem] bg-surface-2" />)
        ) : q.isError ? (
          <QueryError onRetry={() => q.refetch()} />
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
              <Link key={b.id} to="/pro/booking/$id" params={{ id: b.id }} className="focus-ring tap-scale block rounded-[2rem] border border-border/50 bg-surface-elevated p-5 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex items-center gap-4">
                  <Avatar src={b.customer?.avatar_url} alt={name} className="h-14 w-14 shrink-0 shadow-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 truncate">
                        <div className="truncate text-base font-extrabold text-foreground">{name}</div>
                        <StatusPill tone={statusTone(b.status)}>{String(t(`pro.statuses.${b.status}`, { defaultValue: b.status }))}</StatusPill>
                      </div>
                      <div className="text-base font-black text-brand">{formatEGP(Number(b.price_total ?? 0))}</div>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <span className="truncate">{serviceName}</span>
                      <span>•</span>
                      <span>{start.toLocaleDateString(dateLoc, { weekday: "short", day: "numeric", month: "short" })}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-3 text-[11px] font-bold text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-1"><Calendar className="h-3 w-3" />{start.toLocaleDateString(dateLoc, { month: "short", day: "numeric" })}</span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-1"><Clock className="h-3 w-3" />{start.toLocaleTimeString(dateLoc, { hour: "numeric", minute: "2-digit" })} · {hours}h</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </ProviderShell>
  );
}
