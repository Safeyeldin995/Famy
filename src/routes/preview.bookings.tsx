import { createFileRoute } from "@tanstack/react-router";
import { Route as BookingsRoute } from "./bookings";
import { BookingDetailContent } from "./booking.$id";

const Bookings = BookingsRoute.options.component!;

export const Route = createFileRoute("/preview/bookings")({
  validateSearch: (search: Record<string, unknown>) => ({
    bookingId: typeof search.bookingId === "string" ? search.bookingId : undefined,
  }),
  component: PreviewBookings,
});

function PreviewBookings() {
  const { bookingId } = Route.useSearch();
  return bookingId ? <BookingDetailContent bookingId={bookingId} /> : <Bookings />;
}
