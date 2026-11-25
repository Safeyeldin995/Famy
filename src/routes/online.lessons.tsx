import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";

export const Route = createFileRoute("/online/lessons")({
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  component: () => <Outlet />,
});