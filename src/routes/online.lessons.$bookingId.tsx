import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";

export const Route = createFileRoute("/online/lessons/$bookingId")({
  validateSearch: (search: Record<string, unknown> = {}) => ({
    paymob_return: search.paymob_return === "1" || search.paymob_return === 1 ? ("1" as const) : undefined,
  }),
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  component: () => <Outlet />,
});