import { BookingRequestActions } from "@/components/provider/BookingRequestActions";
import { WorkMoney } from "@/components/provider/WorkMoney";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { formatDate, formatTime } from "@/lib/format";
import { ProviderPendingHome } from "@/components/provider/ProviderPendingHome";
import { isPreviewRoute, PREVIEW_NOW_ISO } from "@/lib/preview/constants";
import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { PageHeader } from "@/components/famio/PageHeader";
import { ProviderSectionHeader } from "@/components/famio/ProviderSectionHeader";
import { EmptyState } from "@/components/famio/ui";
import { useLang } from "@/components/famio/LanguageToggle";
import { useMyProvider, useProviderBookings, useProviderEarnings, useProUnreadNotificationCount } from "@/lib/db/provider-queries";
import { formatEGP, BOOKING_ACTIVE_STATUSES } from "@/lib/utils";
import { earningsHeadlineKind } from "@/lib/earnings/aggregateProviderEarnings";
import type { ReactNode } from "react";
import { Bell, Star, Plane, AlertCircle } from "lucide-react";
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
  const unreadQ = useProUnreadNotificationCount();
  const unread = unreadQ.data ?? 0;

  const all = bookingsQ.data ?? [];
  const pending = all.filter((b: any) => b.status === "pending");
  const preview = useRouterState({ select: (state) => isPreviewRoute(state.location.pathname) });
  const today = preview ? new Date(PREVIEW_NOW_ISO) : new Date();
  const upcoming = all
    .filter(
      (b: any) =>
        BOOKING_ACTIVE_STATUSES.includes(b.status) && new Date(b.start_at) >= new Date(today.toDateString()),
    )
    .sort((a: any, b: any) => +new Date(a.start_at) - +new Date(b.start_at))
    .slice(0, 3);

  const mtdNet = earningsQ.data?.mtd.net ?? 0;
  const mtdBookingValue = earningsQ.data?.mtd.bookingValue ?? 0;
  const mtdKind = earningsHeadlineKind(mtdNet > 0, mtdBookingValue > 0);
  const rating = provider?.ratings?.[0]?.rating_avg ?? provider?.ratings?.rating_avg;

  if (!isPreviewRoute() && ["SUBMITTED", "UNDER_REVIEW", "NEEDS_CHANGES"].includes(provider?.onboarding_status)) {
    return <ProviderShell><ProviderPendingHome providerId={provider?.id} changesRequested={provider?.onboarding_status === "NEEDS_CHANGES"} reviewReason={provider?.review_reason_public} /></ProviderShell>;
  }

  return (
    <ProviderShell>
      <PageHeader
        title={t("proWork.hello", { name: (provider?.profile?.full_name || provider?.name || t("pro.common.customer")).trim().split(/\s+/)[0] })}
        right={
          <div className="flex items-center gap-2">
          <ProfileAvatar src={provider?.profile?.avatar_url} name={provider?.profile?.full_name || provider?.name || ""} className="h-11 w-11 rounded-full" />
          <Link
            to={proPath("/pro/notifications") as "/pro/notifications"}
            aria-label={t("notifs.title")}
            className="focus-ring relative grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface-2 text-brand"
          >
            <Bell className="h-5 w-5" strokeWidth={ICON_STROKE_BOLD} aria-hidden="true" />
            {unread > 0 ? (
              <span className="absolute end-2 top-2 h-2 w-2 rounded-full bg-white ring-2 ring-brand" />
            ) : null}
          </Link>
          </div>
        }
      />

      <div className="space-y-3 px-5">
        <p className="text-pro-14 text-muted-foreground"><b className="text-foreground">{t("proWork.today")}</b> · {upcoming[0] ? <Link className="font-bold text-brand" to={proPath("/pro/booking/$id") as "/pro/booking/$id"} params={{ id: upcoming[0].id }}>{t("proWork.nextJob")}: {formatDate(new Date(upcoming[0].start_at), { day: "numeric", month: "short" }, lang)} · {formatTime(new Date(upcoming[0].start_at), lang)}</Link> : t("proWork.noJobToday")}</p>
        <div className="grid grid-cols-2 gap-3">
          <Link to={proPath("/pro/earnings") as "/pro/earnings"} className="focus-ring block min-w-0 rounded-2xl bg-brand p-3 text-brand-foreground">
            <div className="whitespace-nowrap text-pro-12 font-bold">{mtdKind === "bookingValue" ? t("proWork.monthValue") : t("proWork.monthNet")}</div>
            <div className="mt-2"><WorkMoney amount={mtdKind === "bookingValue" ? mtdBookingValue : mtdNet} /></div>
            {mtdKind === "mixed" && <p className="mt-1 text-pro-12">{t("proWork.monthValue")}<span className="block whitespace-nowrap">{formatEGP(mtdBookingValue)}</span></p>}
          </Link>
          <div className="min-w-0 rounded-2xl border border-border/50 bg-surface p-3">
            <div className="whitespace-nowrap text-pro-12 font-bold text-muted-foreground">{t("proWork.rating")}</div>
            <div className="mt-2 flex items-center gap-1 text-pro-22 font-extrabold"><Star className="h-4 w-4 fill-warning text-warning" aria-hidden="true" />{rating ? Number(rating).toFixed(2) : "—"}</div>
          </div>
        </div>
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
                className="shrink-0 rounded-full bg-brand px-3 py-2 text-pro-12 font-extrabold text-brand-foreground"
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
                to={proPath("/pro/apply") as "/pro/apply"}
                className="shrink-0 rounded-full bg-destructive px-3 py-2 text-pro-12 font-extrabold text-destructive-foreground"
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
                to={proPath("/pro/apply") as "/pro/apply"}
                className="shrink-0 rounded-full bg-warning px-3 py-2 text-pro-12 font-extrabold text-warning-foreground"
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
                  request
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
  request,
  lang,
  dateLoc,
  t,
}: {
  b: any;
  request?: boolean;
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
    <article className="overflow-hidden rounded-2xl border border-border/50 bg-surface">
    <Link
      to={proPath("/pro/booking/$id") as "/pro/booking/$id"}
      params={{ id: b.id }}
      className="focus-ring tap-scale block p-3"
    >
      <div className="flex items-center gap-3">
        <ProfileAvatar src={b.customer?.avatar_url} name={name} className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-extrabold text-foreground">{name}</p>
            <p className="shrink-0 whitespace-nowrap text-sm font-black text-brand">{formatEGP(Number(b.price_total ?? 0))}</p>
          </div>
          <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
            {serviceName} ·{" "}
            {formatDate(start, { weekday: "short", day: "numeric", month: "short" }, dateLoc)}
          </p>
        </div>
      </div>
    </Link>
    {request && <BookingRequestActions id={b.id} />}
    </article>
  );
}
