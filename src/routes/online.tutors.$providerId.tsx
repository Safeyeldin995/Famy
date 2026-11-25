import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/online/tutors/$providerId")({
  component: () => <Outlet />,
});