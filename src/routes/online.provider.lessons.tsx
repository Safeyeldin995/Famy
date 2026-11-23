import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";

export const Route = createFileRoute("/online/provider/lessons")({
  beforeLoad: async () => {
    await requireOnlineWebSession("/online/provider/lessons");
  },
  component: OnlineProviderLessons,
});

function OnlineProviderLessons() {
  const { t } = useTranslation();
  return (
    <div className="rounded-3xl bg-white p-8 shadow-sm">
      <h1 className="text-pro-22 font-extrabold">{t("onlineWeb.providerLessons.title")}</h1>
      <p className="mt-3 text-pro-15 text-muted-foreground">{t("onlineWeb.providerLessons.lead")}</p>
    </div>
  );
}