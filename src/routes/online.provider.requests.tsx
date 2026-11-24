import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";

export const Route = createFileRoute("/online/provider/requests")({
  beforeLoad: async () => {
    await requireOnlineWebSession("/online/provider/requests");
  },
  component: OnlineProviderRequests,
});

function OnlineProviderRequests() {
  const { t } = useTranslation();
  return (
    <div className="rounded-3xl bg-white p-8 shadow-sm">
      <h1 className="text-pro-22 font-extrabold">{t("onlineWeb.providerRequests.title")}</h1>
      <p className="mt-3 text-pro-15 text-muted-foreground">{t("onlineWeb.providerRequests.lead")}</p>
    </div>
  );
}