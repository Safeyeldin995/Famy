import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { OtpCodeInput } from "@/components/auth/OtpCodeInput";
import { ArrowRight, Clock, MessageSquareText } from "lucide-react";
import { PhoneFrame, PrimaryButton } from "@/components/famio/ui";
import type { AuthFlowPurpose, OtpScreenContext } from "@/lib/auth/authIntent.types";
import {
  hasFirebasePhoneVerificationSession,
  phoneOtpFlowErrorMessage,
  resendPhoneOtpFlow,
  verifyPhoneOtpCode,
} from "@/lib/otp/phoneOtpFlow";
import { otpService } from "@/lib/otp/OtpService";
import { useApp } from "@/lib/store";
import { formatOtpExpiryClock, formatOtpSecondsDuration } from "@/lib/auth/otpCountdown";

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

export type OtpContextData = Extract<OtpScreenContext, { ok: true }>;

function Otp() {
  const { otpContext } = Route.useRouteContext();
  return <OtpScreen otpContext={otpContext} />;
}

export function OtpScreen({
  otpContext,
  previewMode = false,
}: {
  otpContext: OtpContextData;
  previewMode?: boolean;
}) {
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
    if (previewMode) return;
    const id = window.setInterval(() => {
      setOtpExpiresIn((value) => Math.max(0, value - 1));
      setResendAvailableIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [previewMode]);

  useEffect(() => {
    if (otpExpiresIn !== 0) return;
    if (previewMode) return;
    void otpService.abandonOtpFlow().then(() => {
      toast.error(t("auth.sessionExpired", "Your verification session expired. Start again."));
      nav({ to: otpContext.purpose === "reset" ? "/auth/forgot" : "/login", replace: true });
    });
  }, [nav, otpContext.purpose, otpExpiresIn, previewMode, t]);

  useEffect(() => {
    if (previewMode || otpContext.delivery !== "firebase") return;
    if (!hasFirebasePhoneVerificationSession()) {
      const msg = t(
        "auth.firebaseSessionLost",
        "Your SMS verification session expired on this page. Tap resend to get a new code.",
      );
      setErrorMsg(msg);
    }
  }, [otpContext.delivery, previewMode, t]);

  const verify = async (value: string) => {
    if (previewMode) {
      toast.message(t("preview.otpHint", "Preview only — OTP verification is disabled."));
      return;
    }
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
    if (previewMode) {
      toast.message(t("preview.otpHint", "Preview only — OTP verification is disabled."));
      return;
    }
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
    try {
      const res = await resendPhoneOtpFlow(profile.phone, { languageCode: i18n.language });
      if (!res.ok) {
        const msg = phoneOtpFlowErrorMessage(res.error, t, res.retryAfter, res.firebaseAuthCode);
        toast.error(msg);
        if (res.flowAbandoned) {
          if (res.intentCleared === false) {
            setErrorMsg(msg);
          }
          nav({
            to: otpContext.purpose === "reset" ? "/auth/forgot" : "/login",
            replace: true,
          });
          return;
        }
        setErrorMsg(msg);
        if (res.retryAfter) setResendAvailableIn(res.retryAfter);
        return;
      }
      setResendAvailableIn(res.retryAfter ?? 30);
      setOtpExpiresIn(5 * 60);
      toast.success(t("auth.codeSent", "Code sent."));
    } catch {
      const msg = phoneOtpFlowErrorMessage("firebase_send_failed", t);
      toast.error(msg);
      setErrorMsg(msg);
      nav({
        to: otpContext.purpose === "reset" ? "/auth/forgot" : "/login",
        replace: true,
      });
    } finally {
      setResending(false);
    }
  };

  const changePhone = async () => {
    if (previewMode) {
      nav({ to: "/preview/login", replace: true });
      return;
    }
    await otpService.abandonOtpFlow();
    nav({ to: otpContext.purpose === "reset" ? "/auth/forgot" : "/login", replace: true });
  };

  return (
    <PhoneFrame bg="bg-white">
      <div className="safe-top px-5 pt-4">
        <button
          type="button"
          onClick={changePhone}
          aria-label={t("common.back", "Back")}
          className="focus-ring tap-scale grid h-11 w-11 place-items-center rounded-full border border-border/70 bg-white text-foreground"
        >
          <ArrowRight className="h-5 w-5 ltr:rotate-180" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-1 flex-col px-6 pb-8 pt-6" dir={i18n.dir()}>
        <div className="grid h-16 w-16 place-items-center rounded-3xl bg-brand/10 text-brand">
          <MessageSquareText className="h-8 w-8" strokeWidth={2} aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-[1.75rem] font-extrabold leading-tight text-foreground">
          {copy.title}
        </h1>
        <p className="mt-2 text-pro-14 font-medium leading-relaxed text-muted-foreground">
          {copy.body}{" "}
          <span dir="ltr" className="inline-block font-extrabold tracking-wide text-foreground">
            {otpContext.maskedPhone}
          </span>
        </p>

        <OtpCodeInput
          value={code}
          onChange={setCode}
          onComplete={verify}
          disabled={loading || otpExpiresIn === 0}
          invalid={!!errorMsg}
        />

        {errorMsg && (
          <p className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-center text-pro-13 font-bold text-destructive">
            {errorMsg}
          </p>
        )}

        <div className="mt-6 flex items-center justify-center gap-1.5 text-pro-13 font-semibold text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {t("auth.codeExpiresIn", "Code expires in")}{" "}
          <span dir="ltr" className="font-extrabold text-foreground">
            {formatOtpExpiryClock(otpExpiresIn)}
          </span>
        </div>

        <div className="mt-2 text-center text-pro-13 font-semibold text-muted-foreground">
          {resendAvailableIn > 0 ? (
            <p className="py-3">
              {t("auth.resendIn")}{" "}
              <span className="font-extrabold text-foreground">
                {formatOtpSecondsDuration(resendAvailableIn, t)}
              </span>
            </p>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={resending || loading}
              className="min-h-11 px-3 py-3 font-extrabold text-brand disabled:opacity-50"
            >
              {resending ? t("common.sending", "Sending...") : t("auth.resend")}
            </button>
          )}
        </div>

        <div className="text-center">
          <button
            type="button"
            onClick={changePhone}
            className="min-h-11 px-3 py-3 text-sm font-bold text-muted-foreground underline-offset-4 hover:underline"
          >
            {t("auth.changePhone", "Change phone number")}
          </button>
        </div>

        <div className="mt-auto pt-6">
          <PrimaryButton
            onClick={() => verify(code.join(""))}
            disabled={loading || code.some((digit) => !digit) || otpExpiresIn === 0}
            className="h-14 w-full rounded-2xl shadow-none"
          >
            {loading ? t("common.verifying") : t("common.verify")}
          </PrimaryButton>
        </div>
      </div>
    </PhoneFrame>
  );
}
