import { createFileRoute, Outlet } from "@tanstack/react-router";

// Guests can browse tutors; the request route (/online/tutors/$providerId/request) needs a session.
export const Route = createFileRoute("/online/tutors")({
  component: () => <Outlet />,
});
