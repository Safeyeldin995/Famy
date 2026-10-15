import { useSyncExternalStore } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProviderShell } from "@/components/famio/ProviderShell";
import { PageHeader } from "@/components/famio/PageHeader";
import { NotificationPreferencesPanel } from "@/components/famio/NotificationPreferencesPanel";

export const Route = createFileRoute("/pro/notification-preferences")({
  component: ProNotificationPreferencesRoute,
});

const subscribeNoop = () => () => {};

function ProNotificationPreferencesRoute() {
  // Push support and permission only exist in the browser. Keep SSR and the first client render equal.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const { t } = useTranslation();
  return (
    <ProviderShell hideNav>
      <PageHeader title={t("notifPrefs.title")} backTo="/pro/profile" />
      <div className="px-5 pb-10 pt-2">
        {mounted ? (
          <NotificationPreferencesPanel providerMode />
        ) : (
          <div aria-busy="true" className="h-32 rounded-2xl bg-surface" />
        )}
      </div>
    </ProviderShell>
  );
}
