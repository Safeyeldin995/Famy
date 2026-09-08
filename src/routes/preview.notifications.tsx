import { createFileRoute } from "@tanstack/react-router";
import { Route as NotificationsRoute } from "./notifications";

const Notifications = NotificationsRoute.options.component!;

export const Route = createFileRoute("/preview/notifications")({ component: Notifications });
