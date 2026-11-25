import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";

export const Route = createFileRoute("/online/tutors")({
  // Marketplace search is signed-in only, so browsing tutors needs a session.
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  component: () => <Outlet />,
});
