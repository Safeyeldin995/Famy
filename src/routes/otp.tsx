import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PhoneFrame, PrimaryButton, TopBar } from "@/components/famio/ui";
import { useApp } from "@/lib/store";
import { formatNumber } from "@/lib/utils";
import { otpService } from "@/lib/otp/OtpService";

export const Route = createFileRoute("/otp")({ component: Otp });

function Otp() {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [timer, setTimer] = useState(30);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const nav = useNavigate();
  const { setAuthed, profile, authIntent } = useApp();
  const { t } = useTranslation();

  const purpose = authIntent?.purpose ?? "signup";
  const role = authIntent?.role;

  useEffect(() => {
    refs.current[0]?.focus();
    const id = setInterval(() => setTimer((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const fillFrom = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      const next = [...code];
      next[i] = "";
      setCode(next);
      return;
    }
    const next = [...code];
    let idx = i;
    for (const ch of digits) {
      if (idx >= next.length) break;
      next[idx] = ch;
      idx++;
    }
    setCode(next);
    refs.current[Math.min(idx, next.length - 1)]?.focus();
    if (next.every((c) => c) && !loading) verify(next.join(""));
  };

  const onPaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (/\d/.test(text)) {
      e.preventDefault();
      fillFrom(i, text);
    }
  };

  const verify = async (val: string) => {
    if (val.length < 6 || loading) return;
    if (!profile.phone) {
      toast.error(t("auth.missingPhone", "Phone missing. Please sign in again."));
      nav({ to: "/login" });
      return;
    }
    setLoading(true);
    const res = await otpService.verifyOtp(profile.phone, val, purpose, role);
    setLoading(false);
    if (!res.ok) {
      const msg =
        res.error === "invalid_code" ? t("auth.invalidCode", "Invalid code. Try again.")
        : res.error === "expired" ? t("auth.codeExpired", "Code expired. Request a new one.")
        : res.error === "max_attempts" ? t("auth.maxAttempts", "Too many attempts. Request a new code.")
        : res.error === "already_registered" ? t("auth.alreadyRegistered", "Already registered. Please sign in.")
        : res.error === "no_account" ? t("auth.noAccount", "No account for this number.")
        : t("auth.verifyFailed", "Could not verify code. Try again.");
      toast.error(msg);
      if (res.error === "invalid_code") {
        setCode(Array(code.length).fill(""));
        refs.current[0]?.focus();
      }
      return;
    }
    setAuthed(true);
    // After OTP we always force password setup (new account, or reset).
    nav({ to: "/auth/set-password" });
  };

  const resend = async () => {
    if (timer > 0 || resending || !profile.phone) return;
    setResending(true);
    const res = await otpService.sendOtp(profile.phone, purpose);
    setResending(false);
    if (res.ok) {
      setTimer(res.retryAfter ?? 30);
      toast.success(t("auth.codeSent", "Code sent."));
    } else {
      let msg = t("auth.sendFailed", "Could not send code.");
      if (res.error === "unverified_number") {
        msg = "SMS provider is in trial mode and can't send to this number yet. Add this number to the Twilio verified-caller list, upgrade the Twilio account, or test with an already-verified number.";
      } else if (res.error === "sms_blocked") {
        msg = "SMS delivery is blocked for this number or prefix right now. Try another test number, or review SMS fraud/geo restrictions in the SMS provider account.";
      } else if (res.error === "rate_limited") {
        msg = t("auth.rateLimited", "Too many attempts. Try again in a minute.");
      } else if (res.message) {
        msg = res.message;
      }
      toast.error(msg, { duration: 8000 });
    }
  };

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar back={{ to: "/login" }} />
      <div className="flex-1 px-6 pt-2">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("auth.verifyTitle")}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {t("auth.verifyBody")}{" "}
          <span className="font-semibold text-foreground" dir="ltr">{profile.phone || "+20 1XX XXX XXXX"}</span>
        </p>

        <div className="mt-10 flex justify-between gap-2" dir="ltr">
          {code.map((c, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={c}
              onChange={(e) => fillFrom(i, e.target.value)}
              onPaste={(e) => onPaste(i, e)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !c && i > 0) refs.current[i - 1]?.focus();
              }}
              className={`h-14 w-12 rounded-2xl border-2 bg-surface text-center text-2xl font-extrabold outline-none transition-all ${
                c ? "border-navy text-navy" : "border-border"
              }`}
            />
          ))}
        </div>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          {timer > 0 ? (
            <>{t("auth.resendIn")} <span className="font-bold text-foreground">{formatNumber(timer)}s</span></>
          ) : (
            <button onClick={resend} disabled={resending} className="font-semibold text-navy disabled:opacity-50">
              {resending ? t("common.sending", "Sending...") : t("auth.resend")}
            </button>
          )}
        </div>
      </div>
      <div className="safe-bottom px-6 pt-4">
        <PrimaryButton onClick={() => verify(code.join(""))} disabled={loading || code.some((c) => !c)}>
          {loading ? t("common.verifying") : t("common.verify")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
