import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/preview/admin/reports")({
  component: () => <Outlet />,
});
