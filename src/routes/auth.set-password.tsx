import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Eye, EyeOff, Check } from "lucide-react";
import { PhoneFrame, PrimaryButton, TopBar } from "@/components/famio/ui";
import { otpService } from "@/lib/otp/OtpService";
import { supabase } from "@/integrations/supabase/client";

function clearPasswordFields(
  setPw: (value: string) => void,
  setConfirmPw: (value: string) => void,
  setShow: (value: boolean) => void,
  setShowConfirm: (value: boolean) => void,
) {
  setPw("");
  setConfirmPw("");
  setShow(false);
  setShowConfirm(false);
}

export const Route = createFileRoute("/auth/set-password")({
  beforeLoad: async () => {
    const context = await otpService.getSetPasswordContext();
    if (!context.ok) {
      throw redirect({ to: context.redirect, replace: true });
    }
    return { setPasswordContext: context };
  },
  component: SetPassword,
});

function SetPassword() {
  const { setPasswordContext } = Route.useRouteContext();
  const [pw, setPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [show, setShow] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submitLock = useRef(false);
  const nav = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        nav({ to: "/login", replace: true });
      }
    });
  }, [nav]);

  const longEnough = pw.length >= 8;
  const matches = pw.length > 0 && pw === confirmPw;
  const valid = longEnough && matches;

  const submit = async () => {
    if (!valid || loading || submitLock.current) return;
    submitLock.current = true;
    setErr(null);
    setLoading(true);

    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setLoading(false);
      submitLock.current = false;
      const msg = t("auth.sessionExpired", "Your session expired. Please verify your phone again.");
      setErr(msg);
      toast.error(msg);
      nav({ to: "/login", replace: true });
      return;
    }

    const res = await otpService.completePasswordSetup(pw);
    setLoading(false);
    if (!res.ok) {
      submitLock.current = false;
      const msg = res.message;
      if (res.error === "restart_required") {
        clearPasswordFields(setPw, setConfirmPw, setShow, setShowConfirm);
        setErr(null);
        toast.error(t("auth.passwordRestartRequired", res.message));
        nav({
          to: res.nextStep === "reset" ? "/auth/forgot" : "/login",
          replace: true,
        });
        return;
      }
      if (res.error === "sign_in_required" && res.passwordUpdated) {
        clearPasswordFields(setPw, setConfirmPw, setShow, setShowConfirm);
        setErr(null);
        toast.success(msg);
        nav({ to: "/login", replace: true });
        return;
      }
      setErr(msg);
      toast.error(msg);
      if (res.error === "authorization_missing") {
        clearPasswordFields(setPw, setConfirmPw, setShow, setShowConfirm);
        nav({ to: "/login", replace: true });
      }
      return;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      submitLock.current = false;
      const msg = t("auth.passwordSavedSignIn", "Password saved. Please sign in with your new password.");
      clearPasswordFields(setPw, setConfirmPw, setShow, setShowConfirm);
      setErr(null);
      toast.success(msg);
      nav({ to: "/login", replace: true });
      return;
    }

    toast.success(t("auth.passwordSet", "Password saved."));
    const role = res.role ?? setPasswordContext.role;
    if (role === "provider") {
      nav({ to: "/pro/onboarding", replace: true });
      return;
    }

    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    nav({ to: prof?.full_name ? "/home" : "/setup", replace: true });
  };

  const Rule = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className={`flex items-center gap-2 text-xs ${ok ? "text-emerald-600" : "text-muted-foreground"}`}>
      <Check className={`h-3.5 w-3.5 ${ok ? "opacity-100" : "opacity-40"}`} />
      {label}
    </div>
  );

  const title = setPasswordContext.purpose === "reset"
    ? t("auth.resetPasswordTitle", "Set a new password")
    : t("auth.setPasswordTitle", "Set a password");

  return (
    <PhoneFrame bg="bg-surface">
      <TopBar />
      <div className="flex-1 px-6 pt-2">
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {t("auth.setPasswordBody", "You'll use this to sign in next time.")}{" "}
          <span className="font-semibold text-foreground" dir="ltr">{setPasswordContext.maskedPhone}</span>
        </p>

        <label className="mt-8 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("auth.password", "Password")}
        </label>
        <div className="mt-2 flex h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 focus-within:border-navy">
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            placeholder="••••••••"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground/60"
          />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={t("auth.togglePassword", "Toggle password visibility")} className="text-muted-foreground">
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>

        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("auth.confirmPassword", "Confirm password")}
        </label>
        <div className="mt-2 flex h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 focus-within:border-navy">
          <input
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground/60"
          />
          <button type="button" onClick={() => setShowConfirm((v) => !v)} aria-label={t("auth.toggleConfirmPassword", "Toggle confirm password visibility")} className="text-muted-foreground">
            {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>

        <div className="mt-4 space-y-1.5">
          <Rule ok={longEnough} label={t("auth.ruleLenStrong", "At least 8 characters")} />
          <Rule ok={matches} label={t("auth.passwordsMatch", "Passwords match")} />
        </div>

        {err && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}
      </div>
      <div className="safe-bottom px-6 pt-4">
        <PrimaryButton onClick={submit} disabled={!valid || loading}>
          {loading ? t("common.saving", "Saving…") : t("common.save")}
        </PrimaryButton>
      </div>
    </PhoneFrame>
  );
}
