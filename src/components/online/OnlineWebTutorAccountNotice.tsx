import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PrimaryButton } from "@/components/famio/ui";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

/**
 * Tutor (provider) accounts can't book lessons: booking is for students and
 * parents. Shown instead of a permission error when a tutor opens the booking
 * side of /online.
 */
export function OnlineWebTutorAccountNotice() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-2xl border border-brand/20 bg-brand/5 p-4">
      <p className="text-pro-16 font-bold text-foreground">{t("onlineWeb.tutorAccount.title")}</p>
      <p className="text-pro-14 leading-relaxed text-muted-foreground">
        {t("onlineWeb.tutorAccount.body")}
      </p>
      <Link to={ONLINE_WEB_ROUTE_IDS.providerRequests}>
        <PrimaryButton className="h-11 px-6">{t("onlineWeb.tutorAccount.cta")}</PrimaryButton>
      </Link>
    </div>
  );
}
