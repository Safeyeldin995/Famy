import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { PrimaryButton } from "@/components/famio/ui";
import { useApp } from "@/lib/store";
import { otpService, normalizePhone } from "@/lib/otp/OtpService";
import { normalizeDigitsToWestern } from "@/lib/otp/normalizePhone";
import { startPhoneOtpFlow, phoneOtpFlowErrorMessage } from "@/lib/otp/phoneOtpFlow";
import { interpretSignupSendForLoginPhoneContinue } from "@/lib/auth/loginPhoneContinue";
import { ONLINE_WEB_ROUTE_IDS } from "@/lib/web/onlineWebSurface";
import { stashOnlineWebReturnTo } from "@/lib/web/onlineWebReturnTo";
import { safeOnlineWebReturnTo } from "@/lib/web/onlineWebSession";
import { useAuth } from "@/lib/auth/useAuth";

type Step = "phone" | "password";

export function OnlineWebSignIn({ returnTo }: { returnTo: string }) {
  const nav = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  useEffect(() => {
    stashOnlineWebReturnTo(returnTo);
  }, [returnTo]);
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    nav({ href: safeOnlineWebReturnTo(returnTo, ONLINE_WEB_ROUTE_IDS.home), replace: true });
  }, [authLoading, isAuthenticated, returnTo, nav]);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { setProfile, setAuthed } = useApp();
  const { t, i18n } = useTranslation();

  const phoneValid = normalizeDigitsToWestern(phone).replace(/\D/g, "").length >= 9;

  const signInWithPassword = async () => {
    if (password.length < 1) return;
    setLoading(true);
    const e164 = normalizePhone(phone);
    const res = await otpService.signInWithPassword(e164, password);
    setLoading(false);
    if (!res.ok) {
      const m = t("auth.invalidCredentials");
      setErrorMsg(m);
      toast.error(m);
      return;
    }
    setProfile({ phone: e164 });
    setAuthed(true);
    nav({ href: safeOnlineWebReturnTo(returnTo, ONLINE_WEB_ROUTE_IDS.home), replace: true });
  };

  const continueWithPhone = async () => {
    const e164 = normalizePhone(phone);
    setLoading(true);
    const send = await startPhoneOtpFlow(e164, "signup", "customer", { languageCode: i18n.language });
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
    if (interpreted.kind === "flow_mismatch_signup") {
      const m = t("auth.noAccount");
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    if (interpreted.kind === "registered") {
      setStep("password");
      return;
    }
    if (interpreted.kind === "proceed_signup_otp") {
      stashOnlineWebReturnTo(returnTo);
      setProfile({ phone: e164 });
      nav({ to: ONLINE_WEB_ROUTE_IDS.otp });
      return;
    }
    const m = phoneOtpFlowErrorMessage(
      interpreted.error as Parameters<typeof phoneOtpFlowErrorMessage>[0],
      t,
      interpreted.retryAfter,
      interpreted.firebaseAuthCode,
    );
    setErrorMsg(m);
    toast.error(m, { duration: 8000 });
  };

  const submit = async () => {
    if (loading || !phoneValid) return;
    setErrorMsg(null);
    if (step === "password") {
      await signInWithPassword();
      return;
    }
    await continueWithPhone();
  };

  const fieldClass =
    "flex h-14 items-center rounded-2xl border border-border/80 bg-white transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15";

  const primaryDisabled = !phoneValid || loading || (step === "password" && password.length < 1);
  const primaryLabel =
    loading && step === "password"
      ? t("common.signingIn")
      : loading
        ? t("common.sending")
        : step === "password"
          ? t("auth.signIn")
          : t("auth.continue");

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-3xl bg-white p-8 shadow-sm">
      <div>
        <Link
          to={ONLINE_WEB_ROUTE_IDS.home}
          className="focus-ring text-pro-14 font-bold text-brand"
        >
          {t("common.back")}
        </Link>
        <h1 className="mt-4 text-pro-24 font-extrabold">
          {step === "password" ? t("auth.welcomeBack") : t("onlineWeb.signIn.title")}
        </h1>
        <p className="mt-2 text-pro-14 text-muted-foreground">
          {step === "password" ? t("auth.signInSubtitle") : t("onlineWeb.signIn.lead")}
        </p>
      </div>

      {errorMsg ? (
        <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-pro-13 font-semibold text-destructive">
          {errorMsg}
        </p>
      ) : null}

      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="text-pro-13 font-bold text-muted-foreground">{t("auth.phone")}</span>
          <div className={fieldClass}>
            <span className="px-4 text-pro-15 font-bold text-muted-foreground" dir="ltr">
              +20
            </span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={phone}
              disabled={step === "password"}
              onChange={(e) => setPhone(e.target.value)}
              className="min-h-11 flex-1 bg-transparent pe-4 text-pro-16 outline-none"
              aria-label={t("auth.phone")}
            />
          </div>
        </label>

        {step === "password" ? (
          <label className="block space-y-2">
            <span className="text-pro-13 font-bold text-muted-foreground">{t("auth.password")}</span>
            <div className={fieldClass}>
              <input
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-11 flex-1 bg-transparent px-4 text-pro-16 outline-none"
                aria-label={t("auth.password")}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="focus-ring px-4 text-muted-foreground"
                aria-label={showPw ? t("auth.hidePassword") : t("auth.showPassword")}
              >
                {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </label>
        ) : null}

        {step === "password" ? (
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setPassword("");
              setErrorMsg(null);
            }}
            className="focus-ring text-pro-13 font-bold text-brand"
          >
            {t("auth.changePhone")}
          </button>
        ) : null}
      </div>

      <PrimaryButton
        type="button"
        disabled={primaryDisabled}
        className="h-12 w-full"
        onClick={() => void submit()}
      >
        {primaryLabel}
      </PrimaryButton>
    </div>
  );
}