import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PrimaryButton } from "@/components/famio/ui";
import { OnlineAuthCard, OnlineTextField } from "@/components/online/OnlineWebAuthParts";
import { emailAuthErrorKey, isValidEmail, sendOnlinePasswordResetEmail } from "@/lib/auth/onlineWebAuth";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

export const Route = createFileRoute("/online/forgot-password")({ component: OnlineForgotPassword });

function OnlineForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!isValidEmail(email) || loading) return;
    setLoading(true);
    const res = await sendOnlinePasswordResetEmail(email);
    setLoading(false);
    if (!res.ok && res.error === "rate_limited") {
      toast.error(t(emailAuthErrorKey(res.error)));
      return;
    }
    // Same answer whether or not the email has an account.
    setSent(true);
  };

  return (
    <OnlineAuthCard>
      <div>
        <Link to={ONLINE_WEB_ROUTE_IDS.login} className="focus-ring text-pro-14 font-bold text-brand">
          {t("common.back")}
        </Link>
        <h1 className="mt-4 text-pro-24 font-extrabold">{t("onlineWeb.auth.forgotTitle")}</h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">
          {sent ? t("onlineWeb.auth.forgotSent") : t("onlineWeb.auth.forgotLead")}
        </p>
      </div>
      {!sent ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <OnlineTextField
            id="online-forgot-email"
            label={t("onlineWeb.auth.email")}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            placeholder={t("onlineWeb.auth.emailHint")}
            ltr
          />
          <PrimaryButton type="submit" disabled={!isValidEmail(email) || loading} className="h-12 w-full">
            {loading ? t("common.sending") : t("onlineWeb.auth.sendResetLink")}
          </PrimaryButton>
        </form>
      ) : null}
      <p className="text-pro-13 text-muted-foreground">
        {t("onlineWeb.auth.phoneAccountReset")}{" "}
        <Link to="/auth/forgot" className="focus-ring font-extrabold text-brand">
          {t("onlineWeb.auth.phoneAccountResetLink")}
        </Link>
      </p>
    </OnlineAuthCard>
  );
}
