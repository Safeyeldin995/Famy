import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Calendar, Clock, MapPin } from "lucide-react";
import {
  providerHomeActiveBookingCtaKey,
  providerHomeActiveBookingNeedsAction,
  providerHomeActiveBookingNextStepKey,
  providerHomeActiveBookingStatusKey,
  providerHomeActiveBookingTargetStatus,
  providerHomeActiveBookings,
  pickSoonestProviderHomeActiveBooking,
} from "@/lib/home/activeHomeBookings";
import {
  isBookingTooEarlyError,
  isProviderStepTooEarly,
} from "@/lib/booking/timeWindow";
import { formatCustomerBookingListWhen } from "@/lib/format";
import { currentLang } from "@/lib/i18n";
import { useProPath } from "@/lib/provider/useProPath";
import { useProviderUpdateBookingStatus } from "@/lib/db/provider-queries";
import { ICON_STROKE } from "@/lib/icons/constants";
import type { BookingParty } from "@/lib/db/booking-parties";

type HomeBookingRow = {
  id: string;
  status: string;
  start_at: string;
  customer?: { full_name?: string | null } | null;
  service?: { name_ar?: string | null; name_en?: string | null } | null;
  party?: BookingParty;
};

function serviceLabel(
  service: HomeBookingRow["service"],
  lang: "ar" | "en",
): string {
  if (!service) return "";
  return (lang === "ar" ? service.name_ar : service.name_en) || service.name_en || "";
}

export function HomeProviderActiveBookingCard({
  bookings,
  pendingCount,
}: {
  bookings: HomeBookingRow[];
  pendingCount: number;
}) {
  const { t } = useTranslation();
  const proPath = useProPath();
  const lang = currentLang();
  const mut = useProviderUpdateBookingStatus();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const focus = pickSoonestProviderHomeActiveBooking(bookings);
  const pendingChip =
    pendingCount > 0 ? (
      <Link
        to={proPath("/pro/bookings") as "/pro/bookings"}
        className="focus-ring mx-5 mt-4 inline-flex min-h-9 items-center rounded-full border border-brand bg-brand/10 px-3 text-pro-13 font-bold text-brand"
      >
        {t("providerHome.pendingRequestsChip", { count: pendingCount })}
      </Link>
    ) : null;

  if (!focus) return pendingChip;

  const activeCount = providerHomeActiveBookings(bookings).length;
  const statusKey = providerHomeActiveBookingStatusKey(focus.status);
  const needsAction = providerHomeActiveBookingNeedsAction(focus.status);
  const nextStepKey = providerHomeActiveBookingNextStepKey(focus.status);
  const ctaKey = providerHomeActiveBookingCtaKey(focus.status);
  const nextStatus = providerHomeActiveBookingTargetStatus(focus.status);
  const fullName = focus.party?.other_name || focus.customer?.full_name || t("pro.common.customer");
  const firstName = fullName.trim().split(/\s+/)[0] || fullName;
  const when = formatCustomerBookingListWhen(focus.start_at, lang);
  const area =
    (lang === "ar" ? focus.party?.zone_name_ar : focus.party?.zone_name_en) || focus.party?.area;
  const tooEarly = isProviderStepTooEarly(focus.status, focus.start_at, new Date(nowMs));

  const runStatus = () => {
    if (!nextStatus) return;
    mut.mutate(
      { id: focus.id, status: nextStatus },
      { onError: (e: Error) => isBookingTooEarlyError(e) && mut.reset() },
    );
  };

  return (
    <div className="space-y-2">
      {pendingChip}
      <section
        className={`mx-5 rounded-3xl p-4 ${needsAction ? "mt-2 border-2 border-brand bg-brand/8" : pendingCount > 0 ? "mt-0 border border-border bg-white" : "mt-4 border border-border bg-white"}`}
        data-testid="provider-home-active-booking"
      >
        <p className="text-pro-12 font-bold text-muted-foreground">
          {t("providerHome.activeBookingTitle")}
        </p>
        <p className="mt-1 text-pro-16 font-extrabold text-foreground">
          {statusKey ? t(statusKey) : t(`status.${focus.status}`)}
        </p>
        {nextStepKey ? (
          <p className="mt-1 text-pro-13 font-bold text-muted-foreground">{t(nextStepKey)}</p>
        ) : null}
        <p className="mt-2 text-pro-14 font-bold">{firstName}</p>
        <p className="text-pro-13 text-muted-foreground">{serviceLabel(focus.service, lang)}</p>
        {area ? (
          <p className="mt-1 flex items-center gap-2 text-pro-13 text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span>{area}</span>
          </p>
        ) : null}
        <p className="mt-2 flex items-center gap-2 text-pro-13 text-muted-foreground">
          <Calendar className="h-4 w-4 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
          <Clock className="h-4 w-4 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>{when}</span>
        </p>
        {ctaKey ? (
          <button
            type="button"
            disabled={mut.isPending || tooEarly}
            onClick={runStatus}
            className="focus-ring tap-scale mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-5 text-pro-14 font-extrabold text-brand-foreground disabled:opacity-50"
          >
            {t(ctaKey)}
          </button>
        ) : (
          <Link
            to={proPath("/pro/booking/$id") as "/pro/booking/$id"}
            params={{ id: focus.id }}
            className="focus-ring tap-scale mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-5 text-pro-14 font-extrabold text-brand-foreground"
          >
            {t("providerHome.openBooking")}
          </Link>
        )}
        {activeCount > 1 ? (
          <Link
            to={proPath("/pro/bookings") as "/pro/bookings"}
            className="focus-ring mt-2 inline-flex min-h-11 items-center text-pro-13 font-bold text-brand"
          >
            {t("providerHome.viewAllBookings")} ({activeCount})
          </Link>
        ) : null}
      </section>
    </div>
  );
}
