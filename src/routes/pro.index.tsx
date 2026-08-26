import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { Card, EmptyState, TopBar, Avatar, StatusPill } from "@/components/famio/ui";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderBookings, useProviderEarnings } from "@/lib/db/provider-queries";
import { useUnreadNotificationCount } from "@/lib/db/queries";
import { formatEGP, BOOKING_ACTIVE_STATUSES } from "@/lib/utils";
import { Bell, ShieldCheck, Star, TrendingUp, Plane, AlertCircle } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";

export const Route = createFileRoute("/pro/")({ component: ProDashboard });

function ProDashboard() {
  const { t } = useTranslation();
  const lang = useLang();
  const dateLoc = lang === "ar" ? "ar-EG" : "en-US";
  const p = useMyProvider();
  const provider = p.data as any;
  const bookingsQ = useProviderBookings(provider?.id);
  const earningsQ = useProviderEarnings(provider?.id);
  const unreadQ = useUnreadNotificationCount();
  const unread = unreadQ.data ?? 0;

  const all = bookingsQ.data ?? [];
  const pending = all.filter((b: any) => b.status === "pending");
  const today = new Date();
  const upcoming = all
    .filter((b: any) => BOOKING_ACTIVE_STATUSES.includes(b.status) && new Date(b.start_at) >= new Date(today.toDateString()))
    .sort((a: any, b: any) => +new Date(a.start_at) - +new Date(b.start_at))
    .slice(0, 3);

  const trust = provider?.trust?.[0]?.score ?? provider?.trust?.score;
  const rating = provider?.ratings?.[0]?.rating_avg ?? provider?.ratings?.rating_avg;
  const ratingCount = provider?.ratings?.[0]?.rating_count ?? provider?.ratings?.rating_count ?? 0;

  return (
    <ProviderShell>
      <div className="safe-top px-5 pb-4 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{t("pro.dashboard.title")}</h1>
            <p className="text-sm font-medium text-muted-foreground mt-1">{provider?.name}</p>
          </div>
          <Link to="/pro/notifications" className="focus-ring relative grid h-12 w-12 place-items-center rounded-full bg-surface-elevated shadow-sm border border-border/40 active:scale-95 transition-transform">
            <Bell className="h-5 w-5 text-foreground" strokeWidth={ICON_STROKE_BOLD} />
            {unread > 0 && <span className="absolute right-3 top-3 grid h-3 min-w-3 place-items-center rounded-full bg-brand ring-2 ring-surface text-brand-foreground" />}
          </Link>
        </div>
      </div>

      <div className="space-y-6 px-5 pb-28">
        {provider?.vacation_mode && (
          <div className="flex items-center gap-4 rounded-[2rem] border border-border/50 bg-surface-2 p-5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
              <Plane className="h-6 w-6" strokeWidth={ICON_STROKE_BOLD} />
            </div>
            <div className="flex-1">
              <div className="text-base font-extrabold text-foreground">{t("pro.dashboard.vacationOn")}</div>
              <div className="text-xs font-medium text-muted-foreground mt-0.5">{t("pro.dashboard.vacationOnBody")}</div>
            </div>
            <Link to="/pro/availability" className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-brand-foreground shadow-sm">{t("pro.dashboard.manage")}</Link>
          </div>
        )}

        {!provider?.is_verified && provider?.onboarding_status && ["SUBMITTED", "UNDER_REVIEW"].includes(provider.onboarding_status) && (
          <div className="flex items-center gap-4 rounded-[2rem] bg-warning/10 p-5">
            <AlertCircle className="h-6 w-6 text-warning" strokeWidth={ICON_STROKE_BOLD} />
            <div className="flex-1">
              <div className="text-base font-extrabold text-foreground">{t("pro.onboardingWizard.status.UNDER_REVIEW")}</div>
              <div className="text-xs font-medium text-foreground/70 mt-0.5">{t("pro.onboardingWizard.statusBody.UNDER_REVIEW")}</div>
            </div>
          </div>
        )}

        {!provider?.is_verified && provider?.onboarding_status === "NEEDS_CHANGES" && (
          <div className="flex items-center gap-4 rounded-[2rem] border border-destructive/20 bg-destructive/5 p-5">
            <AlertCircle className="h-6 w-6 text-destructive" strokeWidth={ICON_STROKE_BOLD} />
            <div className="flex-1">
              <div className="text-base font-extrabold text-destructive">{t("pro.onboardingWizard.status.NEEDS_CHANGES")}</div>
              <div className="text-xs font-medium text-destructive/80 mt-0.5">{provider.review_reason_public ?? t("pro.onboardingWizard.changesRequired")}</div>
            </div>
            <Link to="/pro/onboarding" className="rounded-full bg-destructive px-4 py-2 text-xs font-bold text-destructive-foreground shadow-sm">{t("pro.dashboard.manage")}</Link>
          </div>
        )}

        {!provider?.is_verified && (!provider?.onboarding_status || provider?.onboarding_status === "DRAFT") && (
          <div className="flex items-center gap-4 rounded-[2rem] border border-warning/30 bg-warning/5 p-5">
            <AlertCircle className="h-6 w-6 text-warning" strokeWidth={ICON_STROKE_BOLD} />
            <div className="flex-1">
              <div className="text-base font-extrabold text-foreground">{t("pro.dashboard.verifyPending")}</div>
              <div className="text-xs font-medium text-muted-foreground mt-0.5">{t("pro.dashboard.verifyBody")}</div>
            </div>
            <Link to="/pro/onboarding" className="rounded-full bg-warning px-4 py-2 text-xs font-bold text-warning-foreground shadow-sm">{t("pro.dashboard.upload")}</Link>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Link to="/pro/earnings" className="focus-ring tap-scale flex flex-col justify-between rounded-[2rem] bg-brand p-5 text-brand-foreground shadow-float">
            <div className="flex items-center gap-2 text-sm font-bold opacity-80"><TrendingUp className="h-4 w-4" /> {t("pro.dashboard.earningsMtd")}</div>
            <div className="mt-4 text-[1.75rem] font-black leading-none">{formatEGP(earningsQ.data?.mtd ?? 0)}</div>
          </Link>
          <div className="flex flex-col justify-between rounded-[2rem] border border-border/50 bg-surface-elevated p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground"><ShieldCheck className="h-4 w-4" /> {t("pro.dashboard.trustScore")}</div>
            <div className="mt-4">
              <div className="text-[1.75rem] font-black leading-none text-foreground">{trust ? Math.round(trust) : "—"}</div>
              <div className="mt-1 flex items-center gap-1 text-[11px] font-bold text-muted-foreground"><Star className="h-3 w-3 fill-warning text-warning" /> {rating ? Number(rating).toFixed(2) : "—"}</div>
            </div>
          </div>
        </div>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-tight">{t("pro.dashboard.newRequests")}</h2>
            {pending.length > 0 && <Link to="/pro/bookings" className="rounded-full bg-surface-2 px-4 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-surface-elevated">{t("pro.common.seeAll")}</Link>}
          </div>
          {bookingsQ.isLoading ? (
            <div className="h-28 animate-pulse rounded-[2rem] bg-surface-2" />
          ) : bookingsQ.isError ? (
            <EmptyState icon="alert" title={t("common.errorTitle", "Something went wrong")} body={t("common.tryAgain", "Please try again.")} />
          ) : pending.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-border/60 p-8 text-center">
              <p className="text-sm font-bold text-muted-foreground">{t("pro.dashboard.noRequestsBody")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.slice(0, 3).map((b: any) => (
                <BookingRow key={b.id} b={b} cta={t("pro.dashboard.review")} lang={lang} dateLoc={dateLoc} t={t} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-tight">{t("pro.dashboard.upcoming")}</h2>
            <Link to="/pro/bookings" className="rounded-full bg-surface-2 px-4 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-surface-elevated">{t("pro.common.seeAll")}</Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-border/60 p-8 text-center">
              <p className="text-sm font-bold text-muted-foreground">{t("pro.dashboard.noUpcoming")}</p>
            </div>
          ) : (
            <div className="space-y-3">{upcoming.map((b: any) => <BookingRow key={b.id} b={b} lang={lang} dateLoc={dateLoc} t={t} />)}</div>
          )}
        </section>
      </div>
    </ProviderShell>
  );
}

function BookingRow({ b, cta, lang, dateLoc, t }: { b: any; cta?: string; lang: "ar" | "en"; dateLoc: string; t: any }) {
  const start = new Date(b.start_at);
  const name = b.customer?.full_name || t("pro.common.customer");
  const serviceName = lang === "ar" ? (b.service?.name_ar ?? b.service?.name_en) : (b.service?.name_en ?? b.service?.name_ar);
  return (
    <Link to="/pro/booking/$id" params={{ id: b.id }} className="focus-ring tap-scale block rounded-[2rem] bg-surface-elevated p-4 shadow-sm border border-border/40 transition-shadow hover:shadow-md">
      <div className="flex items-center gap-4">
        <Avatar src={b.customer?.avatar_url} alt={name} className="h-14 w-14 shrink-0 shadow-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-base font-extrabold text-foreground">{name}</p>
            <div className="text-sm font-black text-brand">{formatEGP(b.total_price)}</div>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="truncate">{serviceName}</span>
            <span>•</span>
            <span>{start.toLocaleDateString(dateLoc, { weekday: "short", day: "numeric", month: "short" })}</span>
          </div>
          {cta && (
            <div className="mt-3">
              <div className="inline-flex items-center rounded-full bg-brand/10 px-3 py-1.5 text-xs font-extrabold text-brand">
                {cta}
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
