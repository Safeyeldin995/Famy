import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/addresses")({
  component: AddressesLayout,
});

function AddressesLayout() {
  return <Outlet />;
}
