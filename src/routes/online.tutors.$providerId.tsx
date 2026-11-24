import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PrimaryButton } from "@/components/famio/ui";
import { supabase } from "@/integrations/supabase/client";
import { QueryError } from "@/components/famio/QueryError";
import { ProfileAvatar } from "@/components/provider/ProfileAvatar";
import { useProvider, useProviderReviews } from "@/lib/db/queries";
import { toUIProvider, providerPriceLabel } from "@/lib/db/adapters";
import { formatNumber } from "@/lib/format";
import { Star } from "lucide-react";
import { ONLINE_WEB_ROUTE_IDS, onlineWebTutorRequestPath } from "@/lib/web/onlineWebSurface";
import { stashOnlineWebReturnTo } from "@/lib/web/onlineWebReturnTo";

export const Route = createFileRoute("/online/tutors/$providerId")({
  component: OnlineTutorProfile,
});

function OnlineTutorProfile() {
  const { providerId } = Route.useParams();
  const { t, i18n } = useTranslation();
  const providerQ = useProvider(providerId, undefined, "online");
  const reviewsQ = useProviderReviews(providerId);
  const sessionQ = useQuery({
    queryKey: ["online-web-session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return Boolean(data.session);
    },
  });
  const requestPath = onlineWebTutorRequestPath(providerId);

  if (providerQ.isError) {
    return <QueryError onRetry={() => void providerQ.refetch()} />;
  }

  if (providerQ.isLoading || !providerQ.data) {
    return <p className="text-pro-14 text-muted-foreground">{t("common.loading")}</p>;
  }

  const ui = toUIProvider(providerQ.data);
  const priceLabel = providerPriceLabel(ui, t);

  return (
    <div className="space-y-6 rounded-3xl bg-white p-6 shadow-sm">
      <OnlineProfileBackLink />
      <div className="flex items-start gap-4">
        <ProfileAvatar src={ui.avatar} name={ui.name} className="h-16 w-16 rounded-full text-pro-20" />
        <div className="min-w-0 flex-1">
          <h1 className="text-pro-22 font-extrabold">{ui.name || t("provider2.unnamed")}</h1>
          <p className="mt-1 flex items-center gap-1 text-pro-14 text-muted-foreground">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
            {formatNumber(ui.rating, i18n.language)}
            <span aria-hidden>·</span>
            {t("onlineWeb.profile.reviews", { count: reviewsQ.data?.length ?? ui.reviews })}
          </p>
          {priceLabel ? (
            <p className="mt-2 text-pro-16 font-bold text-foreground">{priceLabel}</p>
          ) : null}
        </div>
      </div>
      {ui.bio ? (
        <p className="text-pro-15 leading-relaxed text-muted-foreground">{ui.bio}</p>
      ) : null}
      {sessionQ.data ? (
        <Link to="/online/tutors/$providerId/request" params={{ providerId }}>
          <PrimaryButton className="h-12 w-full">{t("onlineWeb.walkthrough.requestLesson")}</PrimaryButton>
        </Link>
      ) : (
        <Link
          to={ONLINE_WEB_ROUTE_IDS.login}
          search={{ returnTo: requestPath }}
          onClick={() => stashOnlineWebReturnTo(requestPath)}
        >
          <PrimaryButton className="h-12 w-full">{t("onlineWeb.walkthrough.requestLesson")}</PrimaryButton>
        </Link>
      )}
    </div>
  );
}

function OnlineProfileBackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to={ONLINE_WEB_ROUTE_IDS.tutors}
      className="focus-ring inline-flex text-pro-14 font-bold text-brand"
    >
      {t("common.back")}
    </Link>
  );
}