import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { ProviderPageHero } from "@/components/famio/ProviderPageHero";
import { ProviderFloatingPanel } from "@/components/famio/ProviderFloatingPanel";
import { ProviderSectionHeader } from "@/components/famio/ProviderSectionHeader";
import { EmptyState, Avatar } from "@/components/famio/ui";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderBookings, useProviderEarnings } from "@/lib/db/provider-queries";
import { useUnreadNotificationCount } from "@/lib/db/queries";
import { formatEGP, BOOKING_ACTIVE_STATUSES } from "@/lib/utils";
import type { ReactNode } from "react";
import { Bell, ShieldCheck, Star, TrendingUp, Plane, AlertCircle } from "lucide-react";
import { ICON_STROKE_BOLD } from "@/lib/icons/constants";
import { proPath } from "@/lib/preview/previewPath";

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
    .filter(
      (b: any) =>
        BOOKING_ACTIVE_STATUSES.includes(b.status) && new Date(b.start_at) >= new Date(today.toDateString()),
    )
    .sort((a: any, b: any) => +new Date(a.start_at) - +new Date(b.start_at))
    .slice(0, 3);

  const trust = provider?.trust?.[0]?.score ?? provider?.trust?.score;
  const rating = provider?.ratings?.[0]?.rating_avg ?? provider?.ratings?.rating_avg;

  return (
    <ProviderShell>
      <ProviderPageHero
        title={t("pro.dashboard.title")}
        subtitle={provider?.name}
        right={
          <Link
            to={proPath("/pro/notifications") as "/pro/notifications"}
            className="focus-ring relative grid h-10 w-10 place-items-center rounded-xl border border-white/25 bg-white/15 text-white backdrop-blur-sm"
          >
            <Bell className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            {unread > 0 ? (
              <span className="absolute end-2 top-2 h-2 w-2 rounded-full bg-white ring-2 ring-brand" />
            ) : null}
          </Link>
        }
      />

      <div className="px-5">
        <ProviderFloatingPanel className="grid grid-cols-2 gap-3 !p-3">
          <Link
            to={proPath("/pro/earnings") as "/pro/earnings"}
            className="focus-ring tap-scale rounded-[1rem] bg-brand p-4 text-brand-foreground"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold opacity-90">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              {t("pro.dashboard.earningsMtd")}
            </div>
            <div className="mt-2 text-xl font-black leading-none">{formatEGP(earningsQ.data?.mtd ?? 0)}</div>
          </Link>
          <div className="rounded-[1rem] border border-border/50 bg-surface-2/80 p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t("pro.dashboard.trustScore")}
            </div>
            <div className="mt-2 text-xl font-black leading-none text-foreground">
              {trust ? Math.round(trust) : "—"}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
              <Star className="h-3 w-3 fill-warning text-warning" aria-hidden="true" />
              {rating ? Number(rating).toFixed(2) : "—"}
            </div>
          </div>
        </ProviderFloatingPanel>
      </div>

      <div className="mt-5 space-y-5 px-5 pb-28">
        {provider?.vacation_mode ? (
          <AlertBanner
            icon={Plane}
            title={t("pro.dashboard.vacationOn")}
            body={t("pro.dashboard.vacationOnBody")}
            action={
              <Link
                to={proPath("/pro/availability") as "/pro/availability"}
                className="shrink-0 rounded-full bg-brand px-3 py-2 text-[11px] font-extrabold text-brand-foreground"
              >
                {t("pro.dashboard.manage")}
              </Link>
            }
          />
        ) : null}

        {!provider?.is_verified &&
          provider?.onboarding_status &&
          ["SUBMITTED", "UNDER_REVIEW"].includes(provider.onboarding_status) ? (
          <AlertBanner
            icon={AlertCircle}
            tone="warning"
            title={t("pro.onboardingWizard.status.UNDER_REVIEW")}
            body={t("pro.onboardingWizard.statusBody.UNDER_REVIEW")}
          />
        ) : null}

        {!provider?.is_verified && provider?.onboarding_status === "NEEDS_CHANGES" ? (
          <AlertBanner
            icon={AlertCircle}
            tone="danger"
            title={t("pro.onboardingWizard.status.NEEDS_CHANGES")}
            body={provider.review_reason_public ?? t("pro.onboardingWizard.changesRequired")}
            action={
              <Link
                to={proPath("/pro/onboarding") as "/pro/onboarding"}
                className="shrink-0 rounded-full bg-destructive px-3 py-2 text-[11px] font-extrabold text-destructive-foreground"
              >
                {t("pro.dashboard.manage")}
              </Link>
            }
          />
        ) : null}

        {!provider?.is_verified &&
          (!provider?.onboarding_status || provider?.onboarding_status === "DRAFT") ? (
          <AlertBanner
            icon={AlertCircle}
            tone="warning"
            title={t("pro.dashboard.verifyPending")}
            body={t("pro.dashboard.verifyBody")}
            action={
              <Link
                to={proPath("/pro/onboarding") as "/pro/onboarding"}
                className="shrink-0 rounded-full bg-warning px-3 py-2 text-[11px] font-extrabold text-warning-foreground"
              >
                {t("pro.dashboard.upload")}
              </Link>
            }
          />
        ) : null}

        <section>
          <ProviderSectionHeader
            title={t("pro.dashboard.newRequests")}
            action={
              pending.length > 0 ? (
                <Link
                  to={proPath("/pro/bookings") as "/pro/bookings"}
                  className="text-xs font-extrabold text-brand"
                >
                  {t("pro.common.seeAll")}
                </Link>
              ) : null
            }
          />
          {bookingsQ.isLoading ? (
            <div className="h-24 animate-pulse rounded-[1.25rem] bg-surface-2" />
          ) : bookingsQ.isError ? (
            <EmptyState
              icon="alert"
              title={t("common.errorTitle", "Something went wrong")}
              body={t("common.tryAgain", "Please try again.")}
            />
          ) : pending.length === 0 ? (
            <p className="rounded-[1.25rem] border border-dashed border-border/60 p-6 text-center text-sm font-semibold text-muted-foreground">
              {t("pro.dashboard.noRequestsBody")}
            </p>
          ) : (
            <div className="space-y-2.5">
              {pending.slice(0, 3).map((b: any) => (
                <BookingRow
                  key={b.id}
                  b={b}
                  cta={t("pro.dashboard.review")}
                  lang={lang}
                  dateLoc={dateLoc}
                  t={t}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <ProviderSectionHeader
            title={t("pro.dashboard.upcoming")}
            action={
              <Link to={proPath("/pro/bookings") as "/pro/bookings"} className="text-xs font-extrabold text-brand">
                {t("pro.common.seeAll")}
              </Link>
            }
          />
          {upcoming.length === 0 ? (
            <p className="rounded-[1.25rem] border border-dashed border-border/60 p-6 text-center text-sm font-semibold text-muted-foreground">
              {t("pro.dashboard.noUpcoming")}
            </p>
          ) : (
            <div className="space-y-2.5">
              {upcoming.map((b: any) => (
                <BookingRow key={b.id} b={b} lang={lang} dateLoc={dateLoc} t={t} />
              ))}
            </div>
          )}
        </section>
      </div>
    </ProviderShell>
  );
}

function AlertBanner({
  icon: Icon,
  title,
  body,
  action,
  tone = "default",
}: {
  icon: typeof Plane;
  title: string;
  body: string;
  action?: ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/25 bg-destructive/[0.06]"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10"
        : "border-border/50 bg-surface-elevated";

  return (
    <div className={`flex items-start gap-3 rounded-[1.25rem] border p-4 ${toneClass}`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}

function BookingRow({
  b,
  cta,
  lang,
  dateLoc,
  t,
}: {
  b: any;
  cta?: string;
  lang: "ar" | "en";
  dateLoc: string;
  t: any;
}) {
  const start = new Date(b.start_at);
  const name = b.customer?.full_name || t("pro.common.customer");
  const serviceName =
    lang === "ar"
      ? (b.service?.name_ar ?? b.service?.name_en)
      : (b.service?.name_en ?? b.service?.name_ar);

  return (
    <Link
      to={proPath("/pro/booking/$id") as "/pro/booking/$id"}
      params={{ id: b.id }}
      className="focus-ring tap-scale block rounded-[1.25rem] border border-border/50 bg-surface p-4 shadow-xs"
    >
      <div className="flex items-center gap-3">
        <Avatar src={b.customer?.avatar_url} alt={name} className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-extrabold text-foreground">{name}</p>
            <p className="text-sm font-black text-brand">{formatEGP(b.total_price)}</p>
          </div>
          <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
            {serviceName} ·{" "}
            {start.toLocaleDateString(dateLoc, { weekday: "short", day: "numeric", month: "short" })}
          </p>
          {cta ? (
            <span className="mt-2 inline-flex rounded-full bg-brand/10 px-2.5 py-1 text-[10px] font-extrabold text-brand">
              {cta}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
