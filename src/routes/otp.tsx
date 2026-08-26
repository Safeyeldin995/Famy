import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { OtpCodeInput } from "@/components/auth/OtpCodeInput";
import { PhoneFrame, PrimaryButton, TopBar } from "@/components/famio/ui";
import type { AuthFlowPurpose } from "@/lib/auth/authIntent.types";
import {
  hasFirebasePhoneVerificationSession,
  phoneOtpFlowErrorMessage,
  resendPhoneOtpFlow,
  verifyPhoneOtpCode,
} from "@/lib/otp/phoneOtpFlow";
import { otpService } from "@/lib/otp/OtpService";
import { useApp } from "@/lib/store";
import { formatNumber } from "@/lib/utils";

export const Route = createFileRoute("/otp")({
  beforeLoad: async () => {
    const context = await otpService.getOtpScreenContext();
    if (!context.ok) {
      throw redirect({ to: context.redirect, replace: true });
    }
    return { otpContext: context };
  },
  component: Otp,
});

function purposeCopy(purpose: AuthFlowPurpose, t: ReturnType<typeof useTranslation>["t"]) {
  if (purpose === "reset") {
    return {
      title: t("auth.resetVerifyTitle", "Verify password reset"),
      body: t("auth.resetVerifyBody", "Enter the code we sent to reset your password."),
    };
  }
  return {
    title: t("auth.signupVerifyTitle", "Verify your signup"),
    body: t("auth.signupVerifyBody", "Enter the code we sent to finish creating your account."),
  };
}

function Otp() {
  const { otpContext } = Route.useRouteContext();
  const { profile } = useApp();
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [otpExpiresIn, setOtpExpiresIn] = useState(otpContext.otpExpiresIn);
  const [resendAvailableIn, setResendAvailableIn] = useState(otpContext.resendAvailableIn);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const verifyLock = useRef(false);
  const nav = useNavigate();
  const { t, i18n } = useTranslation();
  const copy = purposeCopy(otpContext.purpose, t);

  useEffect(() => {
    const id = window.setInterval(() => {
      setOtpExpiresIn((value) => Math.max(0, value - 1));
      setResendAvailableIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (otpExpiresIn === 0) {
      void otpService.abandonOtpFlow().then(() => {
        toast.error(t("auth.sessionExpired", "Your verification session expired. Start again."));
        nav({ to: otpContext.purpose === "reset" ? "/auth/forgot" : "/login", replace: true });
      });
    }
  }, [nav, otpContext.purpose, otpExpiresIn, t]);

  useEffect(() => {
    if (otpContext.delivery !== "firebase") return;
    if (!hasFirebasePhoneVerificationSession()) {
      const msg = t(
        "auth.firebaseSessionLost",
        "Your SMS verification session expired on this page. Tap resend to get a new code.",
      );
      setErrorMsg(msg);
    }
  }, [otpContext.delivery, t]);

  const verify = async (value: string) => {
    if (value.length !== 6 || loading || verifyLock.current) return;
    verifyLock.current = true;
    setLoading(true);
    setErrorMsg(null);
    const res = await verifyPhoneOtpCode(value);
    setLoading(false);
    if (!res.ok) {
      verifyLock.current = false;
      if (res.error === "flow_mismatch") {
        const msg =
          res.nextStep === "signup"
            ? t(
                "auth.verifyUseSignup",
                "This number is not registered yet. Create an account to continue.",
              )
            : t(
                "auth.verifyUseSignin",
                "This number already has an account. Sign in or reset your password.",
              );
        setErrorMsg(msg);
        toast.error(msg);
        nav({ to: "/login", replace: true });
        return;
      }
      if (res.error === "firebase_session_lost") {
        const msg = phoneOtpFlowErrorMessage("firebase_session_lost", t);
        setErrorMsg(msg);
        toast.error(msg);
        setCode(["", "", "", "", "", ""]);
        return;
      }
      const msg = t("auth.invalidCode", "Invalid code. Try again.");
      setErrorMsg(msg);
      toast.error(msg);
      setCode(["", "", "", "", "", ""]);
      return;
    }
    nav({ to: "/auth/set-password", replace: true });
  };

  const resend = async () => {
    if (resendAvailableIn > 0 || resending || loading) return;
    if (otpContext.delivery === "firebase" && !profile.phone) {
      const msg = t("auth.sessionExpired", "Your verification session expired. Start again.");
      setErrorMsg(msg);
      toast.error(msg);
      nav({ to: otpContext.purpose === "reset" ? "/auth/forgot" : "/login", replace: true });
      return;
    }
    setResending(true);
    setErrorMsg(null);
    const res = await resendPhoneOtpFlow(profile.phone, { languageCode: i18n.language });
    setResending(false);
    if (!res.ok) {
      const msg = phoneOtpFlowErrorMessage(res.error, t);
      setErrorMsg(msg);
      toast.error(msg);
      if (res.retryAfter) setResendAvailableIn(res.retryAfter);
      return;
    }
    setResendAvailableIn(res.retryAfter ?? 30);
    setOtpExpiresIn(5 * 60);
    toast.success(t("auth.codeSent", "Code sent."));
  };

  const changePhone = async () => {
    await otpService.abandonOtpFlow();
    nav({ to: otpContext.purpose === "reset" ? "/auth/forgot" : "/login", replace: true });
  };

  return (
    <PhoneFrame bg="bg-background">
      <TopBar back={{ to: otpContext.purpose === "reset" ? "/auth/forgot" : "/login" }} transparent />
      <div id="firebase-recaptcha" className="hidden" aria-hidden="true" />
      <div className="px-6 pt-2">
        <h1 className="text-[26px] font-black leading-tight tracking-tight text-foreground">{copy.title}</h1>
        <p className="mt-2 text-sm font-semibold leading-relaxed text-muted-foreground">
          {copy.body}{" "}
          <span className="font-black text-foreground" dir="ltr">{otpContext.maskedPhone}</span>
        </p>
      </div>

      <div className="flex-1 px-6 pt-8" dir={i18n.dir()}>
        <OtpCodeInput
          value={code}
          onChange={setCode}
          onComplete={verify}
          disabled={loading || otpExpiresIn === 0}
        />

        <div className="mt-6 text-center text-sm font-semibold text-muted-foreground">
          {t("auth.codeExpiresIn", "Code expires in")}{" "}
          <span className="font-black text-foreground" dir="ltr">
            {formatNumber(Math.floor(otpExpiresIn / 60))}:{String(otpExpiresIn % 60).padStart(2, "0")}
          </span>
        </div>

        <div className="mt-4 text-center text-sm font-semibold text-muted-foreground">
          {resendAvailableIn > 0 ? (
            <>
              {t("auth.resendIn")}{" "}
              <span className="font-black text-foreground" dir="ltr">{formatNumber(resendAvailableIn)}s</span>
            </>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={resending || loading}
              className="font-black text-brand disabled:opacity-50"
            >
              {resending ? t("common.sending", "Sending...") : t("auth.resend")}
            </button>
          )}
        </div>

        <div className="mt-6 text-center">
          <button type="button" onClick={changePhone} className="text-sm font-bold text-muted-foreground">
            {t("auth.changePhone", "Change phone number")}
          </button>
        </div>

        {errorMsg && (
          <p className="mt-6 text-center text-sm font-bold text-destructive px-1">{errorMsg}</p>
        )}
      </div>
      <div className="safe-bottom p-5">
        <PrimaryButton
          onClick={() => verify(code.join(""))}
          disabled={loading || code.some((digit) => !digit) || otpExpiresIn === 0}
          className="shadow-float h-14"
        >
          {loading ? t("common.verifying") : t("common.verify")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
