import { useAdminSessionEvents } from "@/lib/db/admin-session-queries";
import { useTranslation } from "react-i18next";
import { operationDate } from "@/components/admin/operations";

export function AdminOnlineSessionTimeline({
  bookingId,
  serviceMode,
}: {
  bookingId: string;
  serviceMode?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const eventsQ = useAdminSessionEvents(serviceMode === "online" ? bookingId : undefined);

  if (serviceMode !== "online") return null;
  if (eventsQ.isLoading) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">{t("admin.bookings.sessionTimelineLoading")}</p>
    );
  }
  if (eventsQ.isError) {
    return (
      <p className="mt-3 text-xs text-coral">{t("admin.bookings.sessionTimelineError")}</p>
    );
  }
  const rows = eventsQ.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">{t("admin.bookings.sessionTimelineEmpty")}</p>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border/60 bg-surface p-3 text-xs">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {t("admin.bookings.sessionTimeline")}
      </p>
      <ul className="space-y-1">
        {rows.map((ev) => (
          <li key={ev.id} className="flex flex-wrap gap-x-2 gap-y-0.5">
            <span className="font-semibold">
              {t(`admin.bookings.sessionParticipant.${ev.participant}`)}
            </span>
            <span className="text-muted-foreground">{t("admin.bookings.sessionJoined")}:</span>
            <span>{operationDate(ev.joined_at, i18n.language)}</span>
            {ev.left_at ? (
              <>
                <span className="text-muted-foreground">{t("admin.bookings.sessionLeft")}:</span>
                <span>{operationDate(ev.left_at, i18n.language)}</span>
              </>
            ) : (
              <span className="text-brand">{t("admin.bookings.sessionInCall")}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}