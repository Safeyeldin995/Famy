import { createFileRoute } from "@tanstack/react-router";
import { ProBookingDetail } from "./pro.booking.$id";

export const Route = createFileRoute("/preview/pro/booking/$id")({
  component: PreviewProBooking,
});

function PreviewProBooking() {
  const { id } = Route.useParams();
  return <ProBookingDetail id={id} />;
}
