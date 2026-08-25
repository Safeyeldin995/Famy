import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, TopBar, Chip, Badge, EmptyState, Avatar, SecondaryButton } from "@/components/famio/ui";
import { useMyBookings } from "@/lib/db/queries";
import { bookingStatusTone, formatEGP, formatNumber } from "@/lib/utils";
import { currentLang } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Clock, Repeat, Download, ChevronRight } from "lucide-react";
import { ICON_STROKE } from "@/lib/icons/constants";

export const Route = createFileRoute("/bookings")({ component: Bookings });

type Tab = "upcoming" | "completed" | "cancelled";

const TAB_STATUSES: Record<Tab, string[]> = {
  upcoming: ["pending", "confirmed", "on_the_way", "arrived", "arrival_confirmed", "in_progress", "completion_requested", "disputed"],
  completed: ["completed"],
  cancelled: ["cancelled", "no_show"],
};

function Bookings() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("upcoming");
  const q = useMyBookings();
  const lang = currentLang();
  const locale = lang === "ar" ? "ar-EG" : "en-US";

  const list = useMemo(() => {
    const all = q.data ?? [];
    return all.filter((b: any) => TAB_STATUSES[tab].includes(b.status));
  }, [q.data, tab]);

  return (
    <AppShell>
      <TopBar title={t("bookings.title")} />

      <div className="px-5 pb-4">
        <div className="rounded-[1.125rem] bg-surface-2 p-1">
          <div className="grid grid-cols-3 gap-1">
            {(["upcoming", "completed", "cancelled"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`focus-ring tap-scale min-h-11 rounded-xl text-xs font-bold transition-all sm:text-sm ${
                  tab === key ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {t(`bookings.${key}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3 px-5 pb-6">
        {q.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-[1.25rem] bg-muted" />)
        ) : q.isError ? (
          <EmptyState icon="alert" title={t("common.errorTitle")} body={t("common.tryAgain")} />
        ) : list.length === 0 ? (
          <Empty tab={tab} />
        ) : (
          list.map((b: any) => {
            const profile = b.provider?.profile ?? {};
            const name = profile.full_name || t("profile.famioUser");
            const serviceLabel = (lang === "ar" ? b.service?.name_ar : b.service?.name_en) || "";
            const start = new Date(b.start_at);
            const end = new Date(b.end_at);
            const hours = Math.max(1, Math.round((+end - +start) / 36e5));
            const dateLabel = start.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
            const timeLabel = start.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
            const shortId = b.id.slice(0, 8).toUpperCase();
            return (
              <article key={b.id} className="surface-card overflow-hidden shadow-sm">
                <Link to="/booking/$id" params={{ id: b.id }} className="focus-ring tap-scale block p-4">
                  <div className="flex gap-0">
                    <div className="w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                    <div className="min-w-0 flex-1 ps-3">
                      <div className="flex items-start gap-3">
                        <Avatar src={profile.avatar_url} alt={name} className="h-14 w-14 rounded-xl" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-foreground">{name}</p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{serviceLabel}</p>
                            </div>
                            <Badge tone={bookingStatusTone(b.status)}>{t(`status.${b.status}` as any, b.status) as string}</Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3 w-3" strokeWidth={ICON_STROKE} aria-hidden="true" /> {dateLabel}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" strokeWidth={ICON_STROKE} aria-hidden="true" /> {timeLabel} · {t("bookings.hoursShort", { hours: formatNumber(hours) })}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-end">
                          <p className="text-sm font-extrabold text-ink">{formatEGP(Number(b.price_total ?? 0))}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground" dir="ltr">#{shortId}</p>
                        </div>
                      </div>
                      {tab === "upcoming" ? (
                        <div className="mt-3 flex justify-end">
                          <ChevronRight className="h-4 w-4 text-muted-foreground rtl-flip" strokeWidth={ICON_STROKE} aria-hidden="true" />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </Link>
                {tab !== "upcoming" ? (
                  <div className="flex gap-2 border-t border-border/70 px-4 pb-4 pt-3">
                    <SecondaryButton
                      className="flex-1"
                      onClick={() => nav({ to: "/book/$providerId", params: { providerId: b.provider_id }, search: { serviceId: undefined } })}
                    >
                      <Repeat className="h-3.5 w-3.5" /> {t("bookings.bookAgain")}
                    </SecondaryButton>
                    <SecondaryButton className="flex-1">
                      <Download className="h-3.5 w-3.5" /> {t("bookings.invoice")}
                    </SecondaryButton>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </AppShell>
  );
}

function Empty({ tab }: { tab: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="calendar"
      title={t("bookings.emptyTitle", { tab: t(`bookings.${tab}`) })}
      body={t("bookings.emptyBody")}
      action={
        <Link
          to="/home"
          className="focus-ring tap-scale inline-flex h-11 min-h-11 items-center justify-center rounded-[1.125rem] bg-ink px-5 text-sm font-bold text-ink-foreground shadow-card"
        >
          {t("bookings.browse")}
        </Link>
      }
    />
  );
}
