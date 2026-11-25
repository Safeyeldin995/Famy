import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  const bookingQ = useBooking(bookingId);
  if (bookingQ.isLoading) return null;
  const booking = bookingQ.data;
  if (!booking || !assertWebOnlineBookingRow(booking).ok) {
    void nav({ to: onlineWebLessonPath(bookingId) });
    return null;
  }
  return (
    <OnlineWebSessionRoom
      bookingId={bookingId}
      onLeave={() => void nav({ to: onlineWebLessonPath(bookingId) })}
    />
  );
}