import { createFileRoute } from "@tanstack/react-router";
import { AdminBookings } from "./admin.bookings";

export const Route = createFileRoute("/preview/admin/bookings")({
  validateSearch: (search: Record<string, unknown>): { status?: string } => ({
    ...(typeof search.status === "string" ? { status: search.status } : {}),
  }),
  component: PreviewAdminBookings,
});

function PreviewAdminBookings() {
  const search = Route.useSearch();
  return <AdminBookings search={search} />;
}
