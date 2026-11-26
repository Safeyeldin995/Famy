import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  BookOpen,
  CalendarClock,
  ChevronLeft,
  Clock,
  Inbox,
  Search,
  Sparkles,
  Video,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PrimaryButton, StatusPill } from "@/components/famio/ui";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { toUIProvider } from "@/lib/db/adapters";
import { useMyBookings, useMyProfile } from "@/lib/db/queries";
import { useMyTeachingCapabilities } from "@/lib/db/teaching-queries";
import { useProviderBookings } from "@/lib/db/provider-queries";
import { formatDate, formatEGP, formatLocale, formatTime } from "@/lib/format";
import { currentLang } from "@/lib/i18n";
import { ICON_STROKE } from "@/lib/icons/constants";
import { ONLINE_WEB_TIME_ZONE } from "@/lib/online/onlineWebCairoTime";
import {
  ONLINE_UPCOMING_STATUSES,
  countdownParts,
  pickNextLesson,
} from "@/lib/online/onlineTutorDirectory";
import { filterWebOnlineBookingRows } from "@/lib/web/webOnlineDataBoundary";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

type Row = {
  id: string;
  status: string;
  start_at: string;
  end_at: string;
  provider?: Record<string, unknown> | null;
  customer?: { full_name?: string | null } | null;
};

function asRows(data: unknown[] | undefined): Row[] {
  return filterWebOnlineBookingRows((data ?? []) as Record<string, unknown>[]).map((b) => ({
    id: String(b.id),
    status: String(b.status),
    start_at: String(b.start_at),
    end_at: String(b.end_at ?? b.start_at),
    provider: (b as { provider?: Record<string, unknown> | null }).provider ?? null,
    customer: (b as { customer?: { full_name?: string | null } | null }).customer ?? null,
  }));
}

/** Re-render every minute so countdowns stay right. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function useCountdownLabel(start: Date, now: number): string {
  const { t } = useTranslation();
  const { days, hours, minutes } = countdownParts(start, now);
  if (days === 0 && hours === 0 && minutes === 0) return t("onlineWeb.hub.cdNow");
  const parts: string[] = [];
  if (days > 0) parts.push(t("onlineWeb.hub.cdDays", { count: days }));
  if (hours > 0) parts.push(t("onlineWeb.hub.cdHours", { count: hours }));
  if (days === 0 && minutes > 0) parts.push(t("onlineWeb.hub.cdMinutes", { count: minutes }));
  return parts.join(currentLang() === "ar" ? " و " : " ");
}

function lessonWhen(iso: string): string {
  const locale = formatLocale(currentLang());
  const d = new Date(iso);
  return `${formatDate(d, { weekday: "long", day: "numeric", month: "long" }, locale, ONLINE_WEB_TIME_ZONE)} · ${formatTime(d, locale, ONLINE_WEB_TIME_ZONE)}`;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-3xl bg-surface p-5 shadow-sm sm:p-6 ${className}`}>{children}</section>;
}

function NextLessonCard({ lesson, now }: { lesson: Row | null; now: number }) {
  const { t } = useTranslation();
  const start = lesson ? new Date(lesson.start_at) : null;
  const countdown = useCountdownLabel(start ?? new Date(now), now);
  if (!lesson || !start) {
    return (
      <Card className="flex flex-col justify-between gap-4">
        <div className="space-y-2">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <CalendarClock className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
          </span>
          <h2 className="text-pro-18 font-extrabold">{t("onlineWeb.hub.noNextLessonTitle")}</h2>
          <p className="text-pro-14 text-muted-foreground">{t("onlineWeb.hub.noNextLessonBody")}</p>
        </div>
        <Link to={ONLINE_WEB_ROUTE_IDS.tutors} className="self-start">
          <PrimaryButton className="h-11 px-6">{t("onlineWeb.hub.bookNew")}</PrimaryButton>
        </Link>
      </Card>
    );
  }
  const ui = lesson.provider ? toUIProvider(lesson.provider) : null;
  const live = lesson.status === "in_progress" || (start.getTime() <= now && new Date(lesson.end_at).getTime() > now);
  return (
    <Card className="space-y-4 border border-brand/20">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-pro-16 font-extrabold text-muted-foreground">{t("onlineWeb.hub.nextLessonTitle")}</h2>
        <StatusPill tone={live ? "success" : "brand"}>
          {t(`status.${lesson.status}` as "status.pending", lesson.status)}
        </StatusPill>
      </div>
      <div className="flex items-center gap-3">
        <ProfileAvatar src={ui?.avatar} name={ui?.name ?? ""} className="h-14 w-14 rounded-full text-pro-18" />
        <div className="min-w-0">
          <p className="truncate text-pro-18 font-extrabold">{ui?.name || t("provider2.unnamed")}</p>
          <p className="mt-1 text-pro-14 text-muted-foreground">{lessonWhen(lesson.start_at)}</p>
        </div>
      </div>
      <p className="flex items-center gap-2 rounded-2xl bg-brand/10 px-4 py-3 text-pro-15 font-bold text-brand">
        {live ? (
          <>
            <Video className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
            {t("onlineWeb.hub.lessonLive")}
          </>
        ) : (
          <>
            <Clock className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
            {t("onlineWeb.hub.startsIn", { value: countdown })}
          </>
        )}
      </p>
      <Link
        to="/online/lessons/$bookingId"
        params={{ bookingId: lesson.id }}
        search={{ paymob_return: undefined }}
        className="block"
      >
        <PrimaryButton className="h-11 w-full">{t("onlineWeb.hub.openLesson")}</PrimaryButton>
      </Link>
    </Card>
  );
}

function useWalletBalance(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: ["customer-wallet-balance-web"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as (name: string) => ReturnType<typeof supabase.rpc>)(
        "customer_wallet_balances",
      );
      if (error) throw error;
      const row = (data as { available_amount?: number }[] | null)?.[0];
      return Number(row?.available_amount ?? 0);
    },
  });
}

/** Signed-in student home: next lesson, actions needed, wallet and shortcuts. */
export function OnlineStudentHome() {
  const { t } = useTranslation();
  const now = useMinuteTick();
  const profileQ = useMyProfile();
  const bookingsQ = useMyBookings({ serviceMode: "online" });
  const walletQ = useWalletBalance(true);
  const rows = useMemo(() => asRows(bookingsQ.data as unknown[] | undefined), [bookingsQ.data]);
  const next = useMemo(() => pickNextLesson(rows, now), [rows, now]);
  const upcoming = rows.filter((r) => ONLINE_UPCOMING_STATUSES.has(r.status) && new Date(r.end_at).getTime() > now);
  const waiting = upcoming.filter((r) => r.status === "pending");
  const toPay = upcoming.filter((r) => r.status === "confirmed" && new Date(r.start_at).getTime() > now);
  const firstName = String(profileQ.data?.full_name ?? "").trim().split(/\s+/)[0] ?? "";

  if (bookingsQ.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-3" aria-busy="true" aria-label={t("onlineWeb.hub.lessonsSkeleton")}>
        <div className="skeleton h-56 rounded-3xl lg:col-span-2" />
        <div className="skeleton h-56 rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-pro-24 font-extrabold lg:text-pro-28">
        {firstName ? t("onlineWeb.hub.hello", { name: firstName }) : t("onlineWeb.hub.helloNoName")}
      </h1>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NextLessonCard lesson={next} now={now} />
        </div>
        <div className="grid gap-4">
          <Card className="space-y-2">
            <p className="flex items-center gap-2 text-pro-14 font-bold text-muted-foreground">
              <Wallet className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden />
              {t("onlineWeb.hub.walletTitle")}
            </p>
            <p className="text-pro-24 font-extrabold" dir="auto">
              {walletQ.isLoading ? "…" : formatEGP(walletQ.data ?? 0)}
            </p>
            <Link to={ONLINE_WEB_ROUTE_IDS.wallet} className="focus-ring inline-flex text-pro-13 font-bold text-brand">
              {t("onlineWeb.hub.walletOpen")}
            </Link>
          </Card>
          <Card className="space-y-3">
            <p className="text-pro-14 font-bold text-muted-foreground">{t("onlineWeb.hub.quickTitle")}</p>
            <div className="flex flex-col gap-2">
              <Link
                to={ONLINE_WEB_ROUTE_IDS.tutors}
                className="focus-ring flex items-center gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-pro-14 font-bold"
              >
                <Search className="h-4 w-4 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
                {t("onlineWeb.hub.bookNew")}
              </Link>
              <Link
                to={ONLINE_WEB_ROUTE_IDS.lessons}
                className="focus-ring flex items-center gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-pro-14 font-bold"
              >
                <BookOpen className="h-4 w-4 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
                {upcoming.length
                  ? t("onlineWeb.hub.upcomingCount", { count: upcoming.length })
                  : t("onlineWeb.hub.allLessons")}
              </Link>
            </div>
          </Card>
        </div>
      </div>
      {toPay.length || waiting.length ? (
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-pro-16 font-extrabold">
            <AlertCircle className="h-5 w-5 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
            {t("onlineWeb.hub.actionsTitle")}
          </h2>
          <ul className="space-y-2">
            {[...toPay, ...waiting].slice(0, 4).map((r) => {
              const ui = r.provider ? toUIProvider(r.provider) : null;
              return (
                <li key={r.id}>
                  <Link
                    to="/online/lessons/$bookingId"
                    params={{ bookingId: r.id }}
                    search={{ paymob_return: undefined }}
                    className="focus-ring flex items-center gap-3 rounded-2xl border border-border/60 bg-white px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-pro-14 font-bold">
                        {r.status === "confirmed" ? t("onlineWeb.hub.actionPay") : t("onlineWeb.hub.actionWaiting")}
                      </p>
                      <p className="mt-0.5 truncate text-pro-13 text-muted-foreground">
                        {(ui?.name || t("provider2.unnamed")) + " · " + lessonWhen(r.start_at)}
                      </p>
                    </div>
                    <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground ltr:rotate-180" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/** Signed-in tutor home: requests waiting, today's lessons, profile completeness. */
export function OnlineTutorHome({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const now = useMinuteTick();
  const bookingsQ = useProviderBookings(providerId);
  const capsQ = useMyTeachingCapabilities(providerId);
  const rows = useMemo(() => asRows(bookingsQ.data as unknown[] | undefined), [bookingsQ.data]);
  const pending = rows.filter((r) => r.status === "pending" && new Date(r.start_at).getTime() > now);
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: ONLINE_WEB_TIME_ZONE }).format(new Date(now));
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: ONLINE_WEB_TIME_ZONE }).format(new Date(iso));
  const today = rows
    .filter((r) => ONLINE_UPCOMING_STATUSES.has(r.status) && r.status !== "pending" && dayKey(r.start_at) === todayKey)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const upcoming = rows.filter(
    (r) => ONLINE_UPCOMING_STATUSES.has(r.status) && r.status !== "pending" && new Date(r.end_at).getTime() > now,
  );
  const approvedCaps = (capsQ.data ?? []).filter((c) => c.status === "approved");
  const locale = formatLocale(currentLang());

  if (bookingsQ.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
        <div className="skeleton h-48 rounded-3xl" />
        <div className="skeleton h-48 rounded-3xl lg:col-span-2" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-pro-24 font-extrabold lg:text-pro-28">{t("onlineWeb.hub.tutorDashTitle")}</h1>
      {capsQ.isSuccess && approvedCaps.length === 0 ? (
        <Card className="flex flex-col gap-3 border border-warning/30 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-pro-16 font-extrabold">
              <Sparkles className="h-5 w-5 text-brand" strokeWidth={ICON_STROKE} aria-hidden />
              {t("onlineWeb.hub.profileIncompleteTitle")}
            </p>
            <p className="mt-1 text-pro-14 text-muted-foreground">{t("onlineWeb.hub.profileIncompleteBody")}</p>
          </div>
          <Link to="/pro/profile" className="shrink-0">
            <PrimaryButton className="h-11 px-6">{t("onlineWeb.hub.completeProfile")}</PrimaryButton>
          </Link>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Inbox className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
            </span>
            <p className="text-pro-18 font-extrabold">
              {pending.length
                ? t("onlineWeb.hub.pendingRequests", { count: pending.length })
                : t("onlineWeb.hub.noPendingRequests")}
            </p>
          </div>
          <Link to={ONLINE_WEB_ROUTE_IDS.providerRequests} className="self-start">
            <PrimaryButton className="h-11 px-6" variant={pending.length ? "coral" : "outline"}>
              {t("onlineWeb.hub.openRequests")}
            </PrimaryButton>
          </Link>
        </Card>
        <Card className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-pro-16 font-extrabold">{t("onlineWeb.hub.todayTitle")}</h2>
            <span className="text-pro-13 text-muted-foreground">
              {t("onlineWeb.hub.tutorUpcoming", { count: upcoming.length })}
            </span>
          </div>
          {today.length === 0 ? (
            <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-pro-14 text-muted-foreground">
              {t("onlineWeb.hub.noTodayLessons")}
            </p>
          ) : (
            <ul className="space-y-2">
              {today.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/online/lessons/$bookingId"
                    params={{ bookingId: r.id }}
                    search={{ paymob_return: undefined }}
                    className="focus-ring flex items-center gap-3 rounded-2xl border border-border/60 bg-white px-4 py-3"
                  >
                    <span className="rounded-xl bg-brand/10 px-3 py-1.5 text-pro-14 font-extrabold text-brand" dir="auto">
                      {formatTime(new Date(r.start_at), locale, ONLINE_WEB_TIME_ZONE)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-pro-14 font-bold">
                      {r.customer?.full_name || t("provider2.unnamed")}
                    </span>
                    <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground ltr:rotate-180" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-4 pt-1">
            <Link to={ONLINE_WEB_ROUTE_IDS.providerLessons} className="focus-ring text-pro-13 font-bold text-brand">
              {t("onlineWeb.hub.openLessons")}
            </Link>
            <Link to="/pro/earnings" className="focus-ring text-pro-13 font-bold text-brand">
              {t("onlineWeb.hub.earnings")}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
