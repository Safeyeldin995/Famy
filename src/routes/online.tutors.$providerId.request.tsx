import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnlineLessonRequestForm } from "@/components/online/OnlineLessonRequestForm";
import { requireOnlineWebSession } from "@/lib/web/onlineWebSession";
import { useMyProvider } from "@/lib/db/provider-queries";
import { OnlineWebTutorAccountNotice } from "@/components/online/OnlineWebTutorAccountNotice";

export const Route = createFileRoute("/online/tutors/$providerId/request")({
  beforeLoad: async ({ location }) => {
    await requireOnlineWebSession(location.href);
  },
  component: OnlineTutorRequestRoute,
});

function OnlineTutorRequestRoute() {
  const { providerId } = Route.useParams();
  const { t } = useTranslation();
  const myProviderQ = useMyProvider();
  const isTutorAccount = Boolean(myProviderQ.data?.id);
  return (
    <div className="space-y-4 rounded-3xl bg-white p-6 shadow-sm">
      <Link
        to="/online/tutors/$providerId"
        params={{ providerId }}
        className="text-pro-14 font-bold text-brand"
      >
        {t("common.back")}
      </Link>
      <h1 className="text-pro-22 font-extrabold">{t("onlineWeb.request.title")}</h1>
      {myProviderQ.isLoading ? (
        <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>
      ) : isTutorAccount ? (
        <OnlineWebTutorAccountNotice />
      ) : (
        <OnlineLessonRequestForm providerId={providerId} />
      )}
    </div>
  );
}