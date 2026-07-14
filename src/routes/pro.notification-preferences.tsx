import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { TopBar } from "@/components/famio/ui";
import { NotificationPreferencesPanel } from "@/components/famio/NotificationPreferencesPanel";

export const Route = createFileRoute("/pro/notification-preferences")({ component: ProNotificationPreferencesRoute });

function ProNotificationPreferencesRoute() {
  const { t } = useTranslation();
  return (
    <ProviderShell hideNav>
      <TopBar back={{ to: "/pro/profile" }} title={t("notifPrefs.title")} />
      <div className="px-5 pb-6">
        <NotificationPreferencesPanel />
      </div>
    </ProviderShell>
  );
}
