import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { BookingParty } from "@/lib/db/booking-parties";
import { useBookingExpirySettings } from "@/lib/db/settings-queries";
import { formatDate, formatTime, formatEGP } from "@/lib/format";
import { useProPath } from "@/lib/provider/useProPath";
import { BookingRequestActions } from "./BookingRequestActions";
import { BookingCountdown } from "./BookingCountdown";
import { ProfileAvatar } from "./ProfileAvatar";

type RequestBooking = {
  id: string;
  start_at: string;
  created_at?: string;
  price_total?: number | null;
  customer?: { full_name?: string | null; avatar_url?: string | null } | null;
  service?: { name_ar?: string | null; name_en?: string | null } | null;
  party?: BookingParty;
};

/** Uses only the area and age already returned by the party-checked query. */
export function ProviderRequestCard({ booking: b }: { booking: RequestBooking }) {
  const proPath = useProPath();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const ar = lang.startsWith("ar");
  const expiry = useBookingExpirySettings();
  const name = b.customer?.full_name || t("pro.common.customer");
  const area = (ar ? b.party?.zone_name_ar : b.party?.zone_name_en) || b.party?.area;
  const child = b.party?.member_first_name;
  const age = b.party?.member_age_years;
  return (
    <article className="overflow-hidden rounded-2xl border border-border/50 bg-surface">
      <Link
        to={proPath("/pro/booking/$id") as "/pro/booking/$id"}
        params={{ id: b.id }}
        className="focus-ring block space-y-2 p-3"
      >
        <div className="flex items-center gap-3">
          <ProfileAvatar
            src={b.customer?.avatar_url}
            name={name}
            className="h-12 w-12 shrink-0 rounded-xl"
          />
          <h3 className="min-w-0 flex-1 break-words text-pro-16 font-extrabold">{name}</h3>
          <span className="shrink-0 whitespace-nowrap text-pro-16 font-extrabold text-brand">
            {formatEGP(Number(b.price_total ?? 0), undefined, lang)}
          </span>
        </div>
        <p className="text-pro-14 font-bold">{ar ? b.service?.name_ar : b.service?.name_en}</p>
        {(area || child) && (
          <p className="text-pro-13 text-muted-foreground">
            {[
              area,
              child &&
                (age != null ? t("pro.booking.childWithAge", { name: child, count: age }) : child),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        <p className="text-pro-13 text-muted-foreground">
          {formatDate(new Date(b.start_at), undefined, lang)} ·{" "}
          {formatTime(new Date(b.start_at), lang)}
        </p>
        {b.created_at && (
          <BookingCountdown createdAt={b.created_at} startAt={b.start_at} settings={expiry.data} />
        )}
      </Link>
      <BookingRequestActions id={b.id} />
    </article>
  );
}
