import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PhoneFrame, TopBar } from "@/components/famio/ui";
import { NotificationPreferencesPanel } from "@/components/famio/NotificationPreferencesPanel";

export const Route = createFileRoute("/notification-preferences")({ component: NotificationPreferencesRoute });

function NotificationPreferencesRoute() {
  const { t } = useTranslation();
  return (
    <PhoneFrame>
      <TopBar back={{ to: "/profile" }} title={t("notifPrefs.title")} />
      <div className="px-5 pb-6">
        <NotificationPreferencesPanel />
      </div>
    </PhoneFrame>
  );
}
