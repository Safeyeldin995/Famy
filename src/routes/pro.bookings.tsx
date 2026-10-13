import { ProviderRequestCard } from "@/components/provider/ProviderRequestCard";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { formatDate, formatTime, formatDuration } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { PageHeader } from "@/components/famio/PageHeader";
import { SegmentedControl, EmptyState, StatusPill } from "@/components/famio/ui";
import { QueryError } from "@/components/famio/QueryError";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderBookings } from "@/lib/db/provider-queries";
import { formatEGP, BOOKING_ACTIVE_STATUSES } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useProPath } from "@/lib/provider/useProPath";

export const Route = createFileRoute("/pro/bookings")({ component: ProBookings });

type Tab = "requests" | "upcoming" | "history";

function statusTone(status: string): "brand" | "success" | "warning" | "muted" {
  if (status === "pending") return "warning";
  if (status === "completed") return "success";
  if (status === "cancelled" || status === "no_show") return "muted";
  return "brand";
}

function ProBookings() {
  const proPath = useProPath();
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
      history: all.filter((b: any) =>
        ["completed", "cancelled", "no_show", "disputed"].includes(b.status),
      ),
    };
  }, [q.data]);

  if (p.isLoading) {
    return (
      <ProviderShell>
        <div className="px-5 py-20">
          <Loader2 className="h-8 w-8 animate-spin text-brand" />
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
    tab === "requests"
      ? t("pro.bookings.emptyRequests")
      : tab === "upcoming"
        ? t("pro.bookings.emptyUpcoming")
        : t("pro.bookings.emptyHistory");

  return (
    <ProviderShell>
      <PageHeader title={t("pro.bookings.title")} />
      <div className="px-5 pb-4 pt-2">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            {
              value: "requests",
              label: `${t("pro.bookings.requests")} (${lists.requests.length})`,
            },
            { value: "upcoming", label: t("pro.bookings.upcoming") },
            { value: "history", label: t("pro.bookings.history") },
          ]}
        />
      </div>

      <div className="space-y-4 px-5 pb-28">
        {q.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-[2rem] bg-surface-2" />
          ))
        ) : q.isError ? (
          <QueryError onRetry={() => q.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={tab === "requests" ? "inbox" : "calendar"}
            title={t("pro.bookings.empty", { tab: tabLabel })}
            body={emptyBody}
          />
        ) : (
          list.map((b: any) => {
            if (tab === "requests") return <ProviderRequestCard key={b.id} booking={b} />;
            const start = new Date(b.start_at);
            const end = new Date(b.end_at);
            const hours = Math.max(1, Math.round((+end - +start) / 36e5));
            const name = b.customer?.full_name || t("pro.common.customer");
            const serviceName =
              lang === "ar"
                ? (b.service?.name_ar ?? b.service?.name_en)
                : (b.service?.name_en ?? b.service?.name_ar);
            return (
              <Link
                key={b.id}
                to={proPath("/pro/booking/$id") as "/pro/booking/$id"}
                params={{ id: b.id }}
                className="focus-ring tap-scale block rounded-[1.25rem] border border-border/50 bg-surface p-4 shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <ProfileAvatar
                    src={b.customer?.avatar_url}
                    name={name}
                    className="h-11 w-11 rounded-full"
                  />
                  <div className="min-w-0 flex-1 truncate text-pro-16 font-extrabold">{name}</div>
                  <div className="shrink-0 whitespace-nowrap text-pro-16 font-extrabold text-brand">
                    {formatEGP(Number(b.price_total ?? 0))}
                  </div>
                </div>
                <p className="mt-2 text-pro-13 leading-relaxed text-muted-foreground">
                  {serviceName} ·{" "}
                  {formatDate(start, { weekday: "short", day: "numeric", month: "short" }, dateLoc)}{" "}
                  · {formatTime(start, dateLoc)} · {formatDuration(hours, lang)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusPill tone={statusTone(b.status)}>
                    {String(t(`pro.statuses.${b.status}`, { defaultValue: b.status }))}
                  </StatusPill>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </ProviderShell>
  );
}
