import { useTranslation } from "react-i18next";
import { formatEGP, formatNumber } from "@/lib/format";
import {
  EARNINGS_LABEL,
  isCommissionSnapshotted,
  providerBookingValue,
} from "@/lib/earnings/aggregateProviderEarnings";
import { bookingTeachingSummary } from "@/lib/tutoring/bookingTeachingSummary";
import { currentLang } from "@/lib/i18n";
import { PARENT_ONLINE_SUPERVISION } from "@/lib/booking/supervisionMode";

export type OnlineProviderBookingSummaryRow = {
  session_duration_min?: number | null;
  start_at: string;
  end_at?: string | null;
  notes?: string | null;
  price_provider_net?: number | null;
  price_subtotal?: number | null;
  price_extras_total?: number | null;
  price_travel_fee?: number | null;
  service?: { name_ar?: string | null; name_en?: string | null } | null;
  teaching_subject_code?: string | null;
  teaching_subject_name_ar?: string | null;
  teaching_subject_name_en?: string | null;
  teaching_curriculum_code?: string | null;
  teaching_curriculum_name_ar?: string | null;
  teaching_curriculum_name_en?: string | null;
  teaching_level_name_ar?: string | null;
  teaching_level_name_en?: string | null;
  supervision_mode?: string | null;
};

type Props = {
  booking: OnlineProviderBookingSummaryRow;
  /** Tighter line clamps for list cards. */
  compact?: boolean;
};

export function OnlineProviderBookingSummary({ booking, compact = false }: Props) {
  const { t } = useTranslation();
  const lang = currentLang();
  const ar = lang.startsWith("ar");
  const serviceName = ar
    ? booking.service?.name_ar ?? booking.service?.name_en
    : booking.service?.name_en ?? booking.service?.name_ar;
  const teaching = bookingTeachingSummary(booking, lang);
  const durationMin =
    booking.session_duration_min ??
    Math.round(
      (new Date(String(booking.end_at ?? booking.start_at)).getTime() -
        new Date(String(booking.start_at)).getTime()) /
        60_000,
    );
  const snap = isCommissionSnapshotted(booking);
  const net = snap ? Number(booking.price_provider_net) : providerBookingValue(booking);
  const netLabel = snap ? t(EARNINGS_LABEL.net) : t(EARNINGS_LABEL.commissionUnrecorded);
  const notes = booking.notes?.trim();
  const noteClamp = compact ? "line-clamp-2" : "";

  return (
    <div className="space-y-1.5 text-pro-13 text-muted-foreground">
      {serviceName ? <p className="text-pro-14 font-bold text-foreground">{serviceName}</p> : null}
      {booking.supervision_mode === PARENT_ONLINE_SUPERVISION ? (
        <p className="font-bold text-foreground">
          {t("bookFlow.supervision.providerLine.parent_online")}
        </p>
      ) : null}
      {teaching ? (
        <p>
          <span className="font-bold">{t("pro.booking.subject")}: </span>
          {teaching}
        </p>
      ) : null}
      {Number.isFinite(durationMin) && durationMin > 0 ? (
        <p>
          {t("bookFlow.sessionLine", {
            minutes: formatNumber(durationMin, lang),
          })}
        </p>
      ) : null}
      <p>
        {netLabel}: <span className="font-bold text-brand">{formatEGP(net, undefined, lang)}</span>
      </p>
      {notes ? (
        <p className={noteClamp}>
          <span className="font-bold">{t("pro.booking.customerNotes")}: </span>
          {notes}
        </p>
      ) : null}
    </div>
  );
}