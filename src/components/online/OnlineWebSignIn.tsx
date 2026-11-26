import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { GraduationCap, Presentation } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import { PhoneNumberField } from "@/components/famio/PhoneNumberField";
import { useApp } from "@/lib/store";
import { otpService } from "@/lib/otp/OtpService";
import { egyptMobileE164 } from "@/lib/otp/normalizePhone";
import { startPhoneOtpFlow, phoneOtpFlowErrorMessage } from "@/lib/otp/phoneOtpFlow";
import { interpretSignupSendForLoginPhoneContinue } from "@/lib/auth/loginPhoneContinue";
import {
  emailAuthErrorKey,
  isValidEmail,
  resendOnlineSignupConfirmation,
  signInOnlineWithEmail,
} from "@/lib/auth/onlineWebAuth";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { stashOnlineWebReturnTo } from "@/lib/web/onlineWebReturnTo";
import { useOnlineWebAuthRedirect } from "@/lib/web/useOnlineWebAuthRedirect";
import {
  OnlineAuthCard,
  OnlineAuthDivider,
  OnlineGoogleButton,
  OnlinePasswordField,
  OnlineTextField,
} from "@/components/online/OnlineWebAuthParts";

export type OnlineSignInAudience = "student" | "tutor";
type Method = "phone" | "email";
type PhoneStep = "phone" | "password";

export function OnlineWebSignIn({
  returnTo,
  audience = "student",
}: {
  returnTo: string;
  audience?: OnlineSignInAudience;
}) {
  useOnlineWebAuthRedirect(returnTo);
  const isTutor = audience === "tutor";
  const nav = useNavigate();
  const { setProfile, setAuthed } = useApp();
  const { t, i18n } = useTranslation();

  const [method, setMethod] = useState<Method>("phone");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tutorNotRegistered, setTutorNotRegistered] = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState(false);

  const e164 = egyptMobileE164(phone);
  const showError = (m: string) => {
    setErrorMsg(m);
    toast.error(m, { duration: 8000 });
  };
  const resetErrors = () => {
    setErrorMsg(null);
    setTutorNotRegistered(false);
    setUnconfirmedEmail(false);
  };

  const signInWithPhonePassword = async () => {
    if (!e164 || password.length < 1) return;
    setLoading(true);
    const res = await otpService.signInWithPassword(e164, password);
    setLoading(false);
    if (!res.ok) {
      showError(t("auth.invalidCredentials"));
      return;
    }
    setProfile({ phone: e164 });
    setAuthed(true);
  };

  const continueWithPhone = async () => {
    if (!e164) return;
    setLoading(true);
    const send = await startPhoneOtpFlow(e164, "signup", "customer", {
      languageCode: i18n.language,
    });
    setLoading(false);
    const interpreted = interpretSignupSendForLoginPhoneContinue(
      send.ok
        ? { ok: true }
        : {
            ok: false,
            error: send.error,
            nextStep: send.nextStep,
            retryAfter: send.retryAfter,
            firebaseAuthCode: send.firebaseAuthCode,
          },
    );
    if (interpreted.kind === "registered") {
      setPhoneStep("password");
      return;
    }
    if (interpreted.kind === "proceed_signup_otp") {
      if (isTutor) {
        // Tutors join through the provider application, never as a new student account.
        setTutorNotRegistered(true);
        setErrorMsg(t("onlineWeb.auth.tutorNotRegistered"));
        return;
      }
      stashOnlineWebReturnTo(returnTo);
      setProfile({ phone: e164 });
      nav({ to: ONLINE_WEB_ROUTE_IDS.otp });
      return;
    }
    if (interpreted.kind === "flow_mismatch_signup") {
      showError(t("auth.noAccount"));
      return;
    }
    showError(
      phoneOtpFlowErrorMessage(
        interpreted.error as Parameters<typeof phoneOtpFlowErrorMessage>[0],
        t,
        interpreted.retryAfter,
        interpreted.firebaseAuthCode,
      ),
    );
  };

  const signInWithEmail = async () => {
    if (!isValidEmail(email) || password.length < 1) return;
    setLoading(true);
    const res = await signInOnlineWithEmail(email, password);
    setLoading(false);
    if (!res.ok) {
      if (res.error === "email_not_confirmed") setUnconfirmedEmail(true);
      showError(t(emailAuthErrorKey(res.error)));
      return;
    }
    setAuthed(true);
  };

  const resendConfirmation = async () => {
    setLoading(true);
    const res = await resendOnlineSignupConfirmation(email);
    setLoading(false);
    if (!res.ok) {
      showError(t(emailAuthErrorKey(res.error)));
      return;
    }
    toast.success(t("onlineWeb.auth.confirmationResent"));
  };

  const submit = async () => {
    if (loading) return;
    resetErrors();
    if (method === "email") {
      await signInWithEmail();
      return;
    }
    if (phoneStep === "password") {
      await signInWithPhonePassword();
      return;
    }
    await continueWithPhone();
  };

  const canSubmit =
    !loading &&
    (method === "email"
      ? isValidEmail(email) && password.length > 0
      : !!e164 && (phoneStep === "phone" || password.length > 0));

  const primaryLabel = loading
    ? method === "phone" && phoneStep === "phone"
      ? t("common.sending")
      : t("common.signingIn")
    : method === "phone" && phoneStep === "phone"
      ? t("auth.continue")
      : t("auth.signIn");

  const switchMethod = (next: Method) => {
    setMethod(next);
    setPhoneStep("phone");
    setPassword("");
    resetErrors();
  };

  return (
    <OnlineAuthCard>
      <div>
        <Link to={ONLINE_WEB_ROUTE_IDS.home} className="focus-ring text-pro-14 font-bold text-brand">
          {t("common.back")}
        </Link>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1 text-pro-12 font-bold text-brand">
          {isTutor ? (
            <Presentation className="h-4 w-4" aria-hidden />
          ) : (
            <GraduationCap className="h-4 w-4" aria-hidden />
          )}
          {isTutor ? t("onlineWeb.auth.tutorBadge") : t("onlineWeb.auth.studentBadge")}
        </span>
        <h1 className="mt-3 text-pro-24 font-extrabold text-balance">
          {isTutor ? t("onlineWeb.auth.tutorTitle") : t("onlineWeb.auth.studentTitle")}
        </h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">
          {isTutor ? t("onlineWeb.auth.tutorLead") : t("onlineWeb.auth.studentLead")}
        </p>
      </div>

      {!isTutor ? (
        <div
          role="tablist"
          aria-label={t("onlineWeb.auth.methodLabel")}
          className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1"
        >
          {(["phone", "email"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={method === m}
              onClick={() => switchMethod(m)}
              className={`focus-ring min-h-11 rounded-xl text-pro-13 font-bold transition-colors ${
                method === m ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {m === "phone" ? t("onlineWeb.auth.methodPhone") : t("onlineWeb.auth.methodEmail")}
            </button>
          ))}
        </div>
      ) : null}

      {errorMsg ? (
        <div className="space-y-2 rounded-2xl bg-destructive/10 px-4 py-3">
          <p className="text-pro-13 font-semibold text-destructive">{errorMsg}</p>
          {tutorNotRegistered ? (
            <a
              href="/login?mode=signup"
              className="focus-ring inline-flex min-h-11 items-center text-pro-13 font-extrabold text-brand"
            >
              {t("onlineWeb.auth.becomeTutor")}
            </a>
          ) : null}
          {unconfirmedEmail ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void resendConfirmation()}
              className="focus-ring inline-flex min-h-11 items-center text-pro-13 font-extrabold text-brand"
            >
              {t("onlineWeb.auth.resendConfirmation")}
            </button>
          ) : null}
        </div>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {method === "phone" ? (
          <>
            <PhoneNumberField
              id="online-login-phone"
              label={t("auth.phoneNumber")}
              value={phone}
              disabled={phoneStep === "password" || loading}
              onChange={(v) => {
                setPhone(v);
                if (errorMsg) resetErrors();
              }}
            />
            {phoneStep === "password" ? (
              <>
                <OnlinePasswordField
                  id="online-login-password"
                  label={t("auth.password")}
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPhoneStep("phone");
                      setPassword("");
                      resetErrors();
                    }}
                    className="focus-ring min-h-11 text-pro-13 font-bold text-brand"
                  >
                    {t("auth.changePhone")}
                  </button>
                  <Link to="/auth/forgot" className="focus-ring inline-flex min-h-11 items-center text-pro-13 font-bold text-brand">
                    {t("auth.forgot")}
                  </Link>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <OnlineTextField
              id="online-login-email"
              label={t("onlineWeb.auth.email")}
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              placeholder={t("onlineWeb.auth.emailHint")}
              ltr
            />
            <OnlinePasswordField
              id="online-login-email-password"
              label={t("auth.password")}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            <Link
              to={ONLINE_WEB_ROUTE_IDS.forgotPassword}
              className="focus-ring inline-flex min-h-11 items-center text-pro-13 font-bold text-brand"
            >
              {t("auth.forgot")}
            </Link>
          </>
        )}

        <PrimaryButton type="submit" disabled={!canSubmit} className="h-12 w-full">
          {primaryLabel}
        </PrimaryButton>
      </form>

      {!isTutor ? (
        <>
          <OnlineGoogleButton returnTo={returnTo} />
          <p className="text-center text-pro-14 text-muted-foreground">
            {t("onlineWeb.auth.noAccount")}{" "}
            <Link
              to={ONLINE_WEB_ROUTE_IDS.signup}
              search={{ returnTo }}
              className="focus-ring font-extrabold text-brand"
            >
              {t("onlineWeb.auth.createAccount")}
            </Link>
          </p>
        </>
      ) : null}

      <OnlineAuthDivider />
      <Link
        to={ONLINE_WEB_ROUTE_IDS.login}
        search={isTutor ? { returnTo } : { returnTo, as: "tutor" }}
        className="focus-ring flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-pro-14 font-bold text-foreground"
      >
        <span>{isTutor ? t("onlineWeb.auth.areYouStudent") : t("onlineWeb.auth.areYouTutor")}</span>
        <span className="text-brand">{t("onlineWeb.auth.signInHere")}</span>
      </Link>
    </OnlineAuthCard>
  );
}
