import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PhoneFrame, PrimaryButton, TopBar } from "@/components/famio/ui";
import { useApp } from "@/lib/store";
import { otpService, normalizePhone } from "@/lib/otp/OtpService";

export const Route = createFileRoute("/auth/forgot")({ component: Forgot });

function Forgot() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const nav = useNavigate();
  const { setProfile, setAuthIntent, setAuthed } = useApp();
  const { t } = useTranslation();
  const valid = phone.replace(/\D/g, "").length >= 9;

  const submit = async () => {
    if (!valid || loading) return;
    setErrorMsg(null);
    const e164 = normalizePhone(phone);
    // TEMPORARY: OTP disabled during pre-launch validation phase.
    // Phone alone is sufficient — go straight to set-password.
    // Re-enable OTP before accepting unmonitored public resets.
    setLoading(true);
    const send = await otpService.sendOtp(e164, "reset");
    if (!send.ok) {
      setLoading(false);
      let m = t("auth.sendFailed", "Could not reset password.");
      if (send.error === "no_account") {
        m = t("auth.noAccount", "No account for this number.");
      } else if (send.message) {
        m = send.message;
      }
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    const verify = await otpService.verifyOtp(e164, "000000", "reset");
    setLoading(false);
    if (!verify.ok) {
      const m = verify.message ?? t("auth.verifyFailed", "Could not reset password.");
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    setProfile({ phone: e164 });
    setAuthIntent({ purpose: "reset" });
    setAuthed(true);
    nav({ to: "/auth/set-password" });
  };

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar back={{ to: "/login" }} />
      <div className="flex-1 px-6 pt-2">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("auth.forgotTitle", "Reset password")}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {t("auth.forgotBody", "Enter your phone. We'll send a verification code so you can set a new password.")}
        </p>

        <label className="mt-8 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("auth.phoneNumber")}
        </label>
        <div className="mt-2 flex h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 focus-within:border-navy">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xl">🇪🇬</span>
            <span className="text-base font-bold" dir="ltr">+20</span>
          </div>
          <div className="h-7 w-px bg-border" />
          <input
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            placeholder={t("auth.phonePlaceholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ""))}
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>
      <div className="safe-bottom px-6 pt-4">
        {errorMsg && (
          <div className="mb-3 rounded-2xl border border-coral/30 bg-coral/10 p-3 text-[13px] font-medium leading-relaxed text-coral">
            {errorMsg}
          </div>
        )}
        <PrimaryButton onClick={submit} disabled={!valid || loading}>
          {loading ? t("common.sending", "Sending…") : t("common.sendCode")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
