import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { ProviderPageHero } from "@/components/famio/ProviderPageHero";
import { NotificationPreferencesPanel } from "@/components/famio/NotificationPreferencesPanel";

export const Route = createFileRoute("/pro/notification-preferences")({ component: ProNotificationPreferencesRoute });

function ProNotificationPreferencesRoute() {
  const { t } = useTranslation();
  return (
    <ProviderShell hideNav>
      <ProviderPageHero title={t("notifPrefs.title")} backTo="/pro/profile" compact />
      <div className="px-5 pb-10 pt-2">
        <NotificationPreferencesPanel />
      </div>
    </ProviderShell>
  );
}
