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
  const { setProfile } = useApp();
  const { t } = useTranslation();
  const valid = phone.replace(/\D/g, "").length >= 9;

  const submit = async () => {
    if (!valid || loading) return;
    setErrorMsg(null);
    const e164 = normalizePhone(phone);
    setLoading(true);
    const send = await otpService.sendOtp(e164, "reset");
    if (!send.ok) {
      setLoading(false);
      const m = send.message ?? t("auth.sendFailed", "Could not reset password.");
      setErrorMsg(m);
      toast.error(m, { duration: 8000 });
      return;
    }
    setProfile({ phone: e164 });
    setLoading(false);
    nav({ to: "/otp" });
  };

  return (
    <PhoneFrame bg="bg-background">
      <div className="safe-top bg-brand px-2 pb-8 pt-2">
        <TopBar back={{ to: "/login" }} transparent />
        <div className="px-4 pt-2">
          <h1 className="text-[26px] font-black leading-tight tracking-tight text-white">
            {t("auth.forgotTitle", "Reset password")}
          </h1>
          <p className="mt-2 text-sm font-semibold leading-relaxed text-white/85">
            {t("auth.forgotBody", "Enter your phone. We'll send a verification code so you can set a new password.")}
          </p>
        </div>
      </div>

      <div className="flex-1 px-5 pt-6">
        <label className="block text-xs font-black uppercase tracking-widest text-muted-foreground">
          {t("auth.phoneNumber")}
        </label>
        <div className="mt-2 flex h-14 items-center gap-3 rounded-2xl bg-surface-2 px-4 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-[10px] font-black text-foreground shadow-xs border border-border/50" aria-hidden="true">EG</span>
          <span className="text-[15px] font-black text-foreground" dir="ltr">+20</span>
          <div className="h-6 w-px bg-border/80" />
          <input
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            placeholder={t("auth.phonePlaceholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, ""))}
            className="min-w-0 flex-1 bg-transparent text-[15px] font-black outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>
      <div className="safe-bottom p-5">
        {errorMsg && (
          <p className="mb-4 text-sm font-bold text-destructive px-1">{errorMsg}</p>
        )}
        <PrimaryButton onClick={submit} disabled={!valid || loading} className="shadow-float h-14">
          {loading ? t("common.sending", "Sending…") : t("common.sendCode")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
