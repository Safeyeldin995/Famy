import { createFileRoute } from "@tanstack/react-router";
import { Route as ProNotificationsRoute } from "./pro.notifications";

const ProNotifications = ProNotificationsRoute.options.component!;

export const Route = createFileRoute("/preview/pro/notifications")({ component: ProNotifications });
