import { createFileRoute } from "@tanstack/react-router";
import { Route as ProNotificationPreferencesRoute } from "./pro.notification-preferences";

const ProNotificationPreferences = ProNotificationPreferencesRoute.options.component!;

export const Route = createFileRoute("/preview/pro/notification-preferences")({
  component: ProNotificationPreferences,
});
