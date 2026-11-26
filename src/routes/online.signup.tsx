import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MailCheck } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import {
  OnlineAuthCard,
  OnlineGoogleButton,
  OnlinePasswordField,
  OnlineTextField,
} from "@/components/online/OnlineWebAuthParts";
import {
  emailAuthErrorKey,
  isValidEmail,
  ONLINE_PASSWORD_MIN_LENGTH,
  resendOnlineSignupConfirmation,
  signUpOnlineStudentWithEmail,
} from "@/lib/auth/onlineWebAuth";
import { useOnlineWebAuthRedirect } from "@/lib/web/useOnlineWebAuthRedirect";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";

export const Route = createFileRoute("/online/signup")({
  validateSearch: (search: Record<string, unknown> = {}): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  component: OnlineSignUpRoute,
});

function OnlineSignUpRoute() {
  const { returnTo } = Route.useSearch();
  return <OnlineWebSignUp returnTo={returnTo ?? ONLINE_WEB_ROUTE_IDS.tutors} />;
}

function OnlineWebSignUp({ returnTo }: { returnTo: string }) {
  useOnlineWebAuthRedirect(returnTo);
  const { t } = useTranslation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const valid =
    fullName.trim().length > 1 &&
    isValidEmail(email) &&
    password.length >= ONLINE_PASSWORD_MIN_LENGTH;

  const submit = async () => {
    if (!valid || loading) return;
    setErrorMsg(null);
    setLoading(true);
    const res = await signUpOnlineStudentWithEmail({ email, password, fullName });
    setLoading(false);
    if (!res.ok) {
      const m = t(emailAuthErrorKey(res.error));
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    // Without email confirmation the session starts now and the redirect hook moves on.
    if (res.needsConfirmation) setSentTo(email.trim().toLowerCase());
  };

  if (sentTo) {
    return (
      <OnlineAuthCard>
        <MailCheck className="h-10 w-10 text-brand" aria-hidden />
        <div className="space-y-2">
          <h1 className="text-pro-24 font-extrabold">{t("onlineWeb.auth.checkEmailTitle")}</h1>
          <p className="text-pro-14 text-muted-foreground">
            {t("onlineWeb.auth.checkEmailBody")}{" "}
            <span dir="ltr" className="font-bold text-foreground">
              {sentTo}
            </span>
          </p>
          <p className="text-pro-13 text-muted-foreground">{t("onlineWeb.auth.checkEmailSpam")}</p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            const res = await resendOnlineSignupConfirmation(sentTo);
            setLoading(false);
            if (res.ok) toast.success(t("onlineWeb.auth.confirmationResent"));
            else toast.error(t(emailAuthErrorKey(res.error)));
          }}
          className="focus-ring inline-flex min-h-11 items-center text-pro-14 font-extrabold text-brand"
        >
          {t("onlineWeb.auth.resendConfirmation")}
        </button>
        <Link
          to={ONLINE_WEB_ROUTE_IDS.login}
          search={{ returnTo }}
          className="focus-ring block text-pro-14 font-bold text-muted-foreground"
        >
          {t("onlineWeb.auth.backToSignIn")}
        </Link>
      </OnlineAuthCard>
    );
  }

  return (
    <OnlineAuthCard>
      <div>
        <Link
          to={ONLINE_WEB_ROUTE_IDS.login}
          search={{ returnTo }}
          className="focus-ring text-pro-14 font-bold text-brand"
        >
          {t("common.back")}
        </Link>
        <h1 className="mt-4 text-pro-24 font-extrabold text-balance">
          {t("onlineWeb.auth.signUpTitle")}
        </h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">{t("onlineWeb.auth.signUpLead")}</p>
      </div>

      {errorMsg ? (
        <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-pro-13 font-semibold text-destructive">
          {errorMsg}
        </p>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <OnlineTextField
          id="online-signup-name"
          label={t("onlineWeb.auth.fullName")}
          value={fullName}
          onChange={setFullName}
          autoComplete="name"
          placeholder={t("onlineWeb.auth.fullNameHint")}
        />
        <OnlineTextField
          id="online-signup-email"
          label={t("onlineWeb.auth.email")}
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder={t("onlineWeb.auth.emailHint")}
          ltr
        />
        <OnlinePasswordField
          id="online-signup-password"
          label={t("auth.password")}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={t("onlineWeb.auth.passwordRule", { min: ONLINE_PASSWORD_MIN_LENGTH })}
        />
        <p className="text-pro-12 leading-6 text-muted-foreground">
          {t("auth.terms")}{" "}
          <Link
            to="/content/$key"
            params={{ key: "terms" }}
            className="font-bold text-foreground underline underline-offset-4"
          >
            {t("auth.termsLink")}
          </Link>{" "}
          {t("auth.and")}{" "}
          <Link
            to="/content/$key"
            params={{ key: "privacy" }}
            className="font-bold text-foreground underline underline-offset-4"
          >
            {t("auth.privacyLink")}
          </Link>
        </p>
        <PrimaryButton type="submit" disabled={!valid || loading} className="h-12 w-full">
          {loading ? t("onlineWeb.auth.creatingAccount") : t("onlineWeb.auth.createAccount")}
        </PrimaryButton>
      </form>

      <OnlineGoogleButton returnTo={returnTo} />

      <p className="text-center text-pro-14 text-muted-foreground">
        {t("onlineWeb.auth.haveAccount")}{" "}
        <Link
          to={ONLINE_WEB_ROUTE_IDS.login}
          search={{ returnTo }}
          className="focus-ring font-extrabold text-brand"
        >
          {t("auth.signIn")}
        </Link>
      </p>
      <p className="text-center text-pro-13 text-muted-foreground">
        {t("onlineWeb.auth.phoneSignupHint")}
      </p>
    </OnlineAuthCard>
  );
}
