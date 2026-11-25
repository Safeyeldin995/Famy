import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OnlineWebSessionRoom } from "@/components/online/OnlineWebSessionRoom";
import { OnlineWebLessonIssueReport } from "@/components/online/OnlineWebLessonIssueReport";
import { siteHeadPrivate, siteLanguage } from "@/lib/site/seo";
import { useBooking } from "@/lib/db/queries";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { assertWebOnlineBookingRow } from "@/lib/web/webOnlineDataBoundary";
import { onlineWebLessonPath } from "@/lib/web/onlineWebSurface";

export const Route = createFileRoute("/online/lessons/$bookingId/room")({
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  head: ({ matches }) =>
    siteHeadPrivate(
      "/online/lessons/room",
      {
        ar: { title: "غرفة الحصة | فامي", description: "حصة أونلاين مباشرة على فامي." },
        en: { title: "Lesson room | Famy", description: "Live online lesson on Famy." },
      },
      siteLanguage(matches),
    ),
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
    <div className="space-y-4">
      <OnlineWebSessionRoom
        bookingId={bookingId}
        onLeave={() => void nav({ to: onlineWebLessonPath(bookingId) })}
      />
      <OnlineWebLessonIssueReport
        bookingId={bookingId}
        startAt={String(booking.start_at)}
        endAt={String(booking.end_at)}
      />
    </div>
  );
}