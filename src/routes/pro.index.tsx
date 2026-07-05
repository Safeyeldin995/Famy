import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { Card, Badge, EmptyState, TopBar } from "@/components/famio/ui";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderBookings, useProviderEarnings } from "@/lib/db/provider-queries";
import { useNotifications } from "@/lib/db/queries";
import { formatEGP, bookingStatusTone } from "@/lib/utils";
import { Bell, ShieldCheck, Star, TrendingUp, Plane, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/pro/")({ component: ProDashboard });

function ProDashboard() {
  const { t } = useTranslation();
  const lang = useLang();
  const dateLoc = lang === "ar" ? "ar-EG" : "en-US";
  const p = useMyProvider();
  const provider = p.data as any;
  const bookingsQ = useProviderBookings(provider?.id);
  const earningsQ = useProviderEarnings(provider?.id);
  const notifQ = useNotifications();
  const unread = (notifQ.data ?? []).filter((n: any) => !n.read_at).length;

  const all = bookingsQ.data ?? [];
  const pending = all.filter((b: any) => b.status === "pending");
  const today = new Date();
  const upcoming = all
    .filter((b: any) => ["confirmed", "in_progress"].includes(b.status) && new Date(b.start_at) >= new Date(today.toDateString()))
    .sort((a: any, b: any) => +new Date(a.start_at) - +new Date(b.start_at))
    .slice(0, 3);

  const trust = provider?.trust?.[0]?.score ?? provider?.trust?.score;
  const rating = provider?.ratings?.[0]?.rating_avg ?? provider?.ratings?.rating_avg;
  const ratingCount = provider?.ratings?.[0]?.rating_count ?? provider?.ratings?.rating_count ?? 0;

  return (
    <ProviderShell>
      <TopBar
        title={t("pro.dashboard.title")}
        right={
          <Link to="/pro/notifications" className="focus-ring relative grid h-11 w-11 place-items-center rounded-full bg-surface shadow-soft active:scale-95">
            <Bell className="h-5 w-5" />
            {unread > 0 && <span className="absolute right-2 top-2 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[10px] font-extrabold text-coral-foreground">{unread > 9 ? "9+" : unread}</span>}
          </Link>
        }
      />

      <div className="space-y-5 px-5 pb-6">
        {provider?.vacation_mode && (
          <Card className="flex items-start gap-3 border border-coral/30 bg-coral/5 p-4">
            <Plane className="mt-0.5 h-5 w-5 text-coral" />
            <div className="flex-1">
              <div className="text-sm font-bold">{t("pro.dashboard.vacationOn")}</div>
              <div className="text-xs text-muted-foreground">{t("pro.dashboard.vacationOnBody")}</div>
            </div>
            <Link to="/pro/availability" className="text-xs font-bold text-navy">{t("pro.dashboard.manage")}</Link>
          </Card>
        )}

        {!provider?.is_verified && (
          <Card className="flex items-start gap-3 border border-amber-500/30 bg-amber-50 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div className="flex-1">
              <div className="text-sm font-bold">{t("pro.dashboard.verifyPending")}</div>
              <div className="text-xs text-muted-foreground">{t("pro.dashboard.verifyBody")}</div>
            </div>
            <Link to="/pro/documents" className="text-xs font-bold text-navy">{t("pro.dashboard.upload")}</Link>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> {t("pro.dashboard.earningsMtd")}</div>
            <div className="mt-1 text-2xl font-extrabold text-navy">{formatEGP(earningsQ.data?.mtd ?? 0)}</div>
            <Link to="/pro/earnings" className="mt-1 inline-block text-[11px] font-bold text-muted-foreground">{t("pro.dashboard.viewDetails")}</Link>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> {t("pro.dashboard.trustScore")}</div>
            <div className="mt-1 text-2xl font-extrabold text-navy">{trust ? Math.round(trust) : "—"}</div>
            <div className="mt-1 text-[11px] text-muted-foreground inline-flex items-center gap-1"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {rating ? Number(rating).toFixed(2) : "—"} · {t("pro.dashboard.reviews", { count: ratingCount })}</div>
          </Card>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-base font-extrabold">{t("pro.dashboard.newRequests")}</h2>
            {pending.length > 0 && <Link to="/pro/bookings" className="text-xs font-bold text-navy">{t("pro.common.seeAll")}</Link>}
          </div>
          {bookingsQ.isLoading ? (
            <div className="h-24 animate-pulse rounded-3xl bg-surface" />
          ) : bookingsQ.isError ? (
            <EmptyState emoji="⚠️" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
          ) : pending.length === 0 ? (
            <EmptyState emoji="📥" title={t("pro.dashboard.noRequests")} body={t("pro.dashboard.noRequestsBody")} />
          ) : (
            <div className="space-y-3">
              {pending.slice(0, 3).map((b: any) => (
                <BookingRow key={b.id} b={b} cta={t("pro.dashboard.review")} lang={lang} dateLoc={dateLoc} t={t} />
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-base font-extrabold">{t("pro.dashboard.upcoming")}</h2>
            <Link to="/pro/bookings" className="text-xs font-bold text-navy">{t("pro.common.seeAll")}</Link>
          </div>
          {upcoming.length === 0 ? (
            <Card className="p-4 text-center text-xs text-muted-foreground">{t("pro.dashboard.noUpcoming")}</Card>
          ) : (
            <div className="space-y-3">{upcoming.map((b: any) => <BookingRow key={b.id} b={b} lang={lang} dateLoc={dateLoc} t={t} />)}</div>
          )}
        </div>
      </div>
    </ProviderShell>
  );
}

function BookingRow({ b, cta, lang, dateLoc, t }: { b: any; cta?: string; lang: "ar" | "en"; dateLoc: string; t: any }) {
  const start = new Date(b.start_at);
  const name = b.customer?.full_name || t("pro.common.customer");
  const serviceName = lang === "ar" ? (b.service?.name_ar ?? b.service?.name_en) : (b.service?.name_en ?? b.service?.name_ar);
  return (
    <Link to="/pro/booking/$id" params={{ id: b.id }} className="block">
      <Card className="flex items-center gap-3 p-3 active:scale-[0.99] transition-transform">
        <img src={b.customer?.avatar_url || `https://i.pravatar.cc/100?u=${b.customer_id}`} alt={name} loading="lazy" className="h-12 w-12 rounded-xl object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-bold">{name}</div>
            <Badge tone={bookingStatusTone(b.status)}>{String(t(`pro.statuses.${b.status}`, { defaultValue: b.status }))}</Badge>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {serviceName ?? t("pro.common.service")} · {start.toLocaleDateString(dateLoc, { weekday: "short", month: "short", day: "numeric" })} · {start.toLocaleTimeString(dateLoc, { hour: "numeric", minute: "2-digit" })}
          </div>
        </div>
        <div className="text-end">
          <div className="text-sm font-extrabold text-navy">{formatEGP(Number(b.price_total ?? 0))}</div>
          {cta && <div className="text-[10px] font-bold text-coral">{cta} →</div>}
        </div>
      </Card>
    </Link>
  );
}
