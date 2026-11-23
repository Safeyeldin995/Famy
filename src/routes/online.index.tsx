import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PrimaryButton } from "@/components/famio/ui";
import { ONLINE_WEB_ROUTE_IDS, ONLINE_WEB_WALLET_TERMS_AR } from "@/lib/web/onlineWebSurface";
import { currentLang } from "@/lib/i18n";

export const Route = createFileRoute("/online/")({
  component: OnlineHome,
});

function OnlineHome() {
  const { t } = useTranslation();
  const walletTerms =
    currentLang() === "ar" ? ONLINE_WEB_WALLET_TERMS_AR : t("onlineWeb.walletTerms");

  return (
    <div className="space-y-8">
      <div className="rounded-3xl bg-white p-8 shadow-sm">
        <h1 className="text-pro-28 font-extrabold text-foreground">{t("onlineWeb.home.title")}</h1>
        <p className="mt-3 max-w-xl text-pro-16 leading-relaxed text-muted-foreground">
          {t("onlineWeb.home.lead")}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to={ONLINE_WEB_ROUTE_IDS.tutors}>
            <PrimaryButton className="h-12 px-6">{t("onlineWeb.home.browseTutors")}</PrimaryButton>
          </Link>
          <Link to={ONLINE_WEB_ROUTE_IDS.login} search={{ returnTo: undefined }}>
            <PrimaryButton variant="outline" className="h-12 px-6">
              {t("onlineWeb.home.signIn")}
            </PrimaryButton>
          </Link>
        </div>
      </div>
      <p className="text-pro-13 leading-relaxed text-muted-foreground">{walletTerms}</p>
    </div>
  );
}