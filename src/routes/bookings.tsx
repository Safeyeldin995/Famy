import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell, TopBar, Chip, Card, Badge, EmptyState } from "@/components/famio/ui";
import { useMyBookings } from "@/lib/db/queries";
import { bookingStatusTone, formatEGP } from "@/lib/utils";
import { currentLang } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Clock, Repeat, Download } from "lucide-react";

export const Route = createFileRoute("/bookings")({ component: Bookings });

type Tab = "upcoming" | "completed" | "cancelled";

const TAB_STATUSES: Record<Tab, string[]> = {
  upcoming: ["pending", "confirmed", "in_progress"],
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
      <div className="flex gap-2 px-5 pb-4">
        <Chip active={tab === "upcoming"} onClick={() => setTab("upcoming")}>{t("bookings.upcoming")}</Chip>
        <Chip active={tab === "completed"} onClick={() => setTab("completed")}>{t("bookings.completed")}</Chip>
        <Chip active={tab === "cancelled"} onClick={() => setTab("cancelled")}>{t("bookings.cancelled")}</Chip>
      </div>

      <div className="space-y-3 px-5">
        {q.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 rounded-3xl bg-surface animate-pulse" />)
        ) : q.isError ? (
          <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
        ) : list.length === 0 ? (
          <Empty tab={tab} />
        ) : (
          list.map((b: any) => {
            const profile = b.provider?.profile ?? {};
            const avatar = profile.avatar_url || `https://i.pravatar.cc/300?u=${b.provider_id}`;
            const name = profile.full_name || t("profile.famioUser");
            const serviceLabel = (lang === "ar" ? b.service?.name_ar : b.service?.name_en) || "";
            const start = new Date(b.start_at);
            const end = new Date(b.end_at);
            const hours = Math.max(1, Math.round((+end - +start) / 36e5));
            const dateLabel = start.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
            const timeLabel = start.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
            const shortId = b.id.slice(0, 8).toUpperCase();
            return (
              <Link key={b.id} to="/booking/$id" params={{ id: b.id }} className="block">
                <Card className="p-4 active:scale-[0.99] transition-transform">
                  <div className="flex items-start gap-3">
                    <img src={avatar} alt={name} loading="lazy" className="h-14 w-14 rounded-2xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-bold">{name}</div>
                        <Badge tone={bookingStatusTone(b.status)}>{t(`status.${b.status}` as any, b.status) as string}</Badge>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{serviceLabel}</div>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" aria-hidden="true" /> {dateLabel}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" /> {timeLabel} · {hours}h</span>
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-extrabold text-navy">{formatEGP(Number(b.price_total ?? 0))}</div>
                      <div className="text-[10px] text-muted-foreground" dir="ltr">#{shortId}</div>
                    </div>
                  </div>
                  {tab !== "upcoming" && (
                    <div className="mt-3 flex gap-2 border-t border-border pt-3">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); nav({ to: "/book/$providerId", params: { providerId: b.provider_id } }); }}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-2 py-2 text-xs font-bold"
                      >
                        <Repeat className="h-3.5 w-3.5" /> {t("bookings.bookAgain")}
                      </button>
                      {/* Invoice download reuses booking.$id.tsx's downloadReceipt logic — not
                          wired here yet since that function isn't currently exported/shared
                          (Sprint 5 audit finding, deferred to avoid an out-of-scope refactor). */}
                      <button className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-2 py-2 text-xs font-bold"><Download className="h-3.5 w-3.5" /> {t("bookings.invoice")}</button>
                    </div>
                  )}
                </Card>
              </Link>
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
      emoji="📅"
      title={t("bookings.emptyTitle", { tab: t(`bookings.${tab}`) })}
      body={t("bookings.emptyBody")}
      action={
        <Link
          to="/home"
          className="focus-ring inline-flex h-11 items-center rounded-2xl bg-navy px-5 text-sm font-bold text-navy-foreground"
        >
          {t("bookings.browse")}
        </Link>
      }
    />
  );
}
