import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { OnlineWebSessionRoom } from "@/components/online/OnlineWebSessionRoom";
import { useBooking } from "@/lib/db/queries";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { assertWebOnlineBookingRow } from "@/lib/web/webOnlineDataBoundary";
import { onlineWebLessonPath } from "@/lib/web/onlineWebSurface";

export const Route = createFileRoute("/online/lessons/$bookingId/room")({
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  component: OnlineLessonRoomRoute,
});

function OnlineLessonRoomRoute() {
  const { bookingId } = Route.useParams();
  const nav = useNavigate();
  const { t } = useTranslation();
  const bookingQ = useBooking(bookingId);

  const booking = bookingQ.data;
  const ok = booking && assertWebOnlineBookingRow(booking).ok;

  useEffect(() => {
    if (bookingQ.isLoading) return;
    if (!ok) {
      void nav({ to: onlineWebLessonPath(bookingId), replace: true });
    }
  }, [bookingQ.isLoading, ok, bookingId, nav]);

  if (bookingQ.isLoading) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!ok || !booking) return null;

  const startAt = new Date(String(booking.start_at));
  const endAt = new Date(String(booking.end_at));

  return (
    <OnlineWebSessionRoom
      bookingId={bookingId}
      startAt={startAt}
      endAt={endAt}
      onLeave={() => void nav({ to: onlineWebLessonPath(bookingId) })}
    />
  );
}