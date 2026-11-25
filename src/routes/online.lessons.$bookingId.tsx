import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { onlineWebLessonPath } from "@/lib/web/onlineWebSurface";

export const Route = createFileRoute("/online/lessons/$bookingId")({
  validateSearch: (search: Record<string, unknown> = {}) => ({
    paymob_return: search.paymob_return === "1" || search.paymob_return === 1 ? ("1" as const) : undefined,
  }),
  beforeLoad: async ({ params }) => {
    await requireOnlineWebSession(onlineWebLessonPath(params.bookingId));
  },
  component: () => <Outlet />,
});