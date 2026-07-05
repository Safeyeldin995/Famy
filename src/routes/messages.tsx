import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/messages")({ component: MessagesLayout });

function MessagesLayout() {
  return <Outlet />;
}
