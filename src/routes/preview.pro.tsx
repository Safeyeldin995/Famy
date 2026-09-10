import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/preview/pro")({
  component: PreviewProLayout,
});

function PreviewProLayout() {
  return <Outlet />;
}
