import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/preview/addresses")({
  component: PreviewAddressesLayout,
});

function PreviewAddressesLayout() {
  return <Outlet />;
}
