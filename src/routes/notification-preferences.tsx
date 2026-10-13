import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PhoneFrame } from "@/components/famio/ui";
import { CustomerPageHeader } from "@/components/famio/CustomerPageHeader";
import { NotificationPreferencesPanel } from "@/components/famio/NotificationPreferencesPanel";

export const Route = createFileRoute("/notification-preferences")({
  component: NotificationPreferencesRoute,
});

function NotificationPreferencesRoute() {
  const { t } = useTranslation();
  return (
    <PhoneFrame bg="bg-background">
      <CustomerPageHeader title={t("notifPrefs.title")} backTo="/profile" />
      <div className="px-5 pb-6 pt-4">
        <NotificationPreferencesPanel />
      </div>
    </PhoneFrame>
  );
}
