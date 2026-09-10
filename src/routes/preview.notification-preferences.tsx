import { createFileRoute } from "@tanstack/react-router";
import { Route as PrefsRoute } from "./notification-preferences";

const NotificationPreferences = PrefsRoute.options.component!;

export const Route = createFileRoute("/preview/notification-preferences")({
  component: NotificationPreferences,
});
