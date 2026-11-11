import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Calendar, Clock } from "lucide-react";
import {
  customerHomeActiveBookingCtaKey,
  customerHomeActiveBookingNeedsAction,
  customerHomeActiveBookings,
  homeActiveBookingStatusKey,
  pickSoonestCustomerHomeActiveBooking,
} from "@/lib/home/activeHomeBookings";
import { currentLang } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { previewPath } from "@/lib/preview/previewPath";
import { ICON_STROKE } from "@/lib/icons/constants";

type HomeBookingRow = {
  id: string;
  status: string;
  start_at: string;
  provider?: { profile?: { full_name?: string | null } } | null;
  service?: { name_ar?: string | null; name_en?: string | null } | null;
};

function serviceLabel(
  service: HomeBookingRow["service"],
  lang: "ar" | "en",
): string {
  if (!service) return "";
  return (lang === "ar" ? service.name_ar : service.name_en) || service.name_en || "";
}

export function HomeActiveBookingCard({ bookings }: { bookings: HomeBookingRow[] }) {
  const { t } = useTranslation();
  const lang = currentLang();
  const focus = pickSoonestCustomerHomeActiveBooking(bookings);
  if (!focus) return null;
  const activeCount = customerHomeActiveBookings(bookings).length;
  const statusKey = homeActiveBookingStatusKey(focus.status);
  const needsAction = customerHomeActiveBookingNeedsAction(focus.status);
  const ctaKey = customerHomeActiveBookingCtaKey(focus.status);
  const name = focus.provider?.profile?.full_name || t("provider2.unnamed");
  const when = formatDateTime(new Date(focus.start_at), lang);

  return (
    <section
      className={`mx-5 mt-4 rounded-3xl p-4 ${needsAction ? "border-2 border-brand bg-brand/8" : "border border-border bg-white"}`}
      data-testid="home-active-booking"
    >
      <p className="text-pro-12 font-bold text-muted-foreground">{t("customerHome.activeBookingTitle")}</p>
      <p className="mt-1 text-pro-16 font-extrabold text-foreground">
        {statusKey ? t(statusKey) : t(`status.${focus.status}`)}
      </p>
      <p className="mt-2 text-pro-14 font-bold">{name}</p>
      <p className="text-pro-13 text-muted-foreground">{serviceLabel(focus.service, lang)}</p>
      <p className="mt-2 flex items-center gap-2 text-pro-13 text-muted-foreground">
        <Calendar className="h-4 w-4 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
        <Clock className="h-4 w-4 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
        <span>{when}</span>
      </p>
      <Link
        to={previewPath("/booking/$id")}
        params={{ id: focus.id }}
        className="focus-ring tap-scale mt-4 flex min-h-12 w-full items-center justify-center rounded-full bg-brand px-5 text-pro-14 font-extrabold text-brand-foreground"
      >
        {t(ctaKey)}
      </Link>
      {activeCount > 1 ? (
        <Link
          to={previewPath("/bookings")}
          className="focus-ring mt-2 inline-flex min-h-11 items-center text-pro-13 font-bold text-brand"
        >
          {t("customerHome.viewAllBookings")} ({activeCount})
        </Link>
      ) : null}
    </section>
  );
}
