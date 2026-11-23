import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { PrimaryButton } from "@/components/famio/ui";

export const Route = createFileRoute("/online/lessons")({
  beforeLoad: async () => {
    await requireOnlineWebSession("/online/lessons");
  },
  component: OnlineLessons,
});

function OnlineLessons() {
  const { t } = useTranslation();
  return (
    <div className="rounded-3xl bg-white p-8 text-center shadow-sm">
      <h1 className="text-pro-22 font-extrabold">{t("onlineWeb.lessons.title")}</h1>
      <p className="mt-3 text-pro-15 text-muted-foreground">{t("onlineWeb.lessons.empty")}</p>
      <Link to={ONLINE_WEB_ROUTE_IDS.tutors} className="mt-6 inline-block">
        <PrimaryButton className="h-12 px-6">{t("onlineWeb.lessons.browse")}</PrimaryButton>
      </Link>
    </div>
  );
}