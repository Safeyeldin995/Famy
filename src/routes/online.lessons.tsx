import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";

export const Route = createFileRoute("/online/lessons")({
  beforeLoad: async () => {
    await requireOnlineWebSession("/online/lessons");
  },
  component: () => <Outlet />,
});